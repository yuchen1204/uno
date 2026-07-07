# UNO Backend 代码质量与安全重构 — 设计文档

> **来源：** 代码评审发现的 7 类问题，全部修复 + Vitest 集成测试 + ESLint/CI

**目标：** 对 `backend/src/index.ts`（1232行）及其周边代码做结构化重构，修复安全漏洞和潜在 bug，建立类型安全、测试覆盖和 CI 体系。

**技术栈：** Cloudflare Workers + Durable Objects (SQLite) + D1 + KV, TypeScript 5.5, Vitest + @cloudflare/vitest-pool-workers, ESLint flat config

---

## 1. 文件结构拆分

### 现状
`backend/src/index.ts` 包含：
- `Env` 接口
- 6 个 Row 接口
- `LobbyDOv2` 类（73-121）
- `GameRoomDOv2` 类（123-1145），包含所有游戏逻辑
- `handleGame` 路由处理函数（1147-1210）
- 默认 export 的 fetch 路由分发（1212-1232）

### 目标结构
```
backend/src/
├── index.ts              # 入口 fetch + 路由分发（~80行）
├── env.ts                # Env 接口 + 所有 DO Row 接口
├── auth.ts               # 不变
├── rooms.ts              # 不变
├── leaderboard.ts        # 不变
├── types.ts              # 不变
├── game/
│   ├── index.ts          # re-exports
│   ├── deck.ts           # 不变
│   ├── rules.ts          # 不变
│   ├── scoring.ts        # 不变
│   ├── lobby-do.ts       # LobbyDOv2 类
│   ├── game-room-do.ts   # GameRoomDOv2 主类|入口（join/leave/alarm/stream/fetch/broadcast）
│   ├── start-game.ts     # handleStartGame + actualStartGame
│   ├── actions/
│   │   ├── draw-card.ts  # handleDrawCard
│   │   ├── play-card.ts  # handlePlayCard + executePlayCard
│   │   ├── skip-turn.ts  # handleSkipTurn
│   │   ├── ready.ts      # toggleReady + continueGame
│   │   └── player-action.ts  # playerAction 路由函数
│   └── utils.ts          # getNextSeat, advanceToNext, reshuffleDiscard,
│                          # getGameState, getAllPlayers, updatePlayerHand,
│                          # updateDeck, touchActivity, ensureIdleAlarm
```

### 职责边界
- **LobbyDOv2** — 公开房间列表的 CRUD（已是独立 DO）
- **GameRoomDOv2** — 生命周期管理（join/leave/alarm/stream），编排但不实现具体游戏逻辑
- **game/actions/\*** — 纯逻辑函数，接收 state + player + payload，返回结果，不出写入 DO SQL
- **GameRoomDOv2 调用 actions** — DO 负责 SQL 写入，action 函数返回指令（更新什么）

---

## 2. 错误堆栈泄露修复

### 问题
`auth.ts:59` 和 `auth.ts:81`：
```typescript
return Response.json({ error: e.message || "注册失败", stack: e.stack }, { status: 500 });
```

### 修复
移除 `stack: e.stack`。保留 `e.message`（生产环境的错误消息是中文提示不是信息泄露），但在 catch 内用 `console.error` 记录完整错误以便调试：
```typescript
} catch (e: any) {
  console.error("handleRegister error:", e);
  return Response.json({ error: e.message || "注册失败" }, { status: 500 });
}
```
同时检查 `index.ts:1229` 的最外层 catch，确保也不泄露堆栈。

---

## 3. 快速模式座位 Token

### 问题
快速模式下，`X-Uno-Nickname` 头在每次请求中传递，`playerAction` 仅对比字符串 `seatOwnerName === player.username`，同一房间内任何人可冒充。

### 修复

#### 3.1 新增列
在 `players` 表增加 `seat_token TEXT`：
```sql
seat_token TEXT NOT NULL DEFAULT ''
```

#### 3.2 生成 token
`joinGame()` 中为新玩家生成随机座位 token：
```typescript
const seatToken = crypto.randomUUID();
// INSERT ... seat_token = seatToken
return { seatIndex, playerCount, seatToken };
```

#### 3.3 校验
`playerAction()` 增加 seat token 检查位：
```typescript
async playerAction(seatIndex: number, action: string, payload?, verify: {
  username?: string; userId?: string; seatToken?: string
}) {
  // ...existing checks...
  const config = this.getRoomConfig();
  if (config?.type === "quick") {
    const row = sql.exec("SELECT seat_token FROM players WHERE seat_index = ?", seatIndex).one();
    if (!verify.seatToken || row.seat_token !== verify.seatToken) {
      return { success: false, error: "座位验证失败" };
    }
  }
}
```

#### 3.4 前端携带
`handleGame()` 路由中解析 `X-Uno-Seat-Token` 头并传入 verify。

---

## 4. 数据库迁移规范化

### 问题
构造函数中 5 处 `try { ALTER TABLE ... } catch {}` 模式。

### 修复
将所有可能缺失的列直接写入初始 `CREATE TABLE` 语句，移除 ALTER TABLE：
- `players` 表原始已经包含 `skip_count` 和 `is_ready`
- `game_state` 表原始已经包含 `countdown_end` 和 `min_value`
- `room_config` 表原始已经包含 `last_activity`
 
由于已有数据可能来自旧 schema（这些列缺失），需要明确处理。最可靠的方式是检测 `migration_version` 表并在该表不存在时执行一次性升级 SQL。然而，由于这个 DO 在开发阶段不涉及生产数据不一致问题（可以全部重建），因此直接修正 CREATE TABLE 语句即可。

同时注意 `players` 表需要新增 `seat_token` 列（见第 3 节），同样在 CREATE TABLE 中声明。

---

## 5. setTimeout 倒计时 → storage.setAlarm

### 问题
`handleStartGame` 和 `toggleReady` 中使用 `setTimeout(() => this.actualStartGame(), 3000)`。Durable Object 在 hibernate 时 JavaScript 运行时暂停，setTimeout 不保证触发。

### 修复

#### 5.1 引入 alarm tags
```typescript
const ALARM_START_GAME = 1;
const ALARM_IDLE_CHECK = 2;
```

#### 5.2 倒计时替换
`handleStartGame()` 和 `toggleReady()` 中：
```typescript
// 旧：setTimeout(() => this.actualStartGame(), COUNTDOWN_DURATION_MS);
// 新：
await this.ctx.storage.setAlarm(Date.now() + COUNTDOWN_DURATION_MS, ALARM_START_GAME);
await this.ctx.storage.transactionSync(() => {
  sql.exec("UPDATE game_state SET phase = 'countdown', countdown_end = ?", Date.now() + COUNTDOWN_DURATION_MS);
  sql.exec("UPDATE room_config SET status = 'countdown'");
});
```

#### 5.3 alarm() 分发
在 `alarm()` 中根据 tag 分发：
```typescript
async alarm(tag?: number) {
  if (tag === ALARM_START_GAME) {
    await this.actualStartGame();
    return;
  }
  // ...existing idle/disconnect logic...
}
```

#### 5.4 倒计时取消
`leaveGame()` 中取消倒计时时调用 `this.ctx.storage.deleteAlarm(ALARM_START_GAME)` 并重置 game_state 为 waiting。

---

## 6. as any 类型安全

### 问题
13+ 处 `as unknown as RowType` 强转，`getGameState()` 返回 `any`。

### 修复
1. 所有 `sql.exec("SELECT ...")` 调用显式指定泛型：
   ```typescript
   sql.exec<PlayerRow>("SELECT * FROM players").toArray()
   ```
2. `getGameState()` 返回类型改为 `GameStateRow | null`
3. 所有 action handler 的参数 `state: any` 改为 `state: GameStateRow`
4. 新增 `GameRoomConfig` 接口整合 DO 内部状态类型
5. 在 rules.ts/canPlayCard 调用处不再需要类型强转

---

## 7. 测试 + Lint + CI

### 测试框架
- **Vitest** + `@cloudflare/vitest-pool-workers` 做 DO 集成测试
- 创建 `backend/vitest.config.ts`

### 测试文件
```
backend/test/
├── rules.test.ts          # canPlayCard 所有边界情况
├── deck.test.ts           # createDeck, shuffleDeck, dealCards
├── scoring.test.ts        # calculateHandScore, cardToScore
├── game-room.test.ts      # 完整游戏流程集成测试
│                          # - 创建房间 → 加入 → 开始 → 出牌 → 摸牌 → 跳过 → 结束
│                          # - 野牌连携系统
│                          # - 罚牌链
│                          # - UNO 声明
│                          # - 玩家离场
│                          # - 断线超时
└── tsconfig.json
```

### ESLint 配置
- `eslint.config.mjs`（flat config）
- `@typescript-eslint` 规则集
- `@typescript-eslint/no-explicit-any: "warn"`（渐进式消除）

### CI 配置
- `.github/workflows/ci.yml`
- 步骤：typecheck → lint → test

---

## 实现顺序
1. 类型安全化（Row 接口 → env.ts，消除 any，GameStateRow）
2. 文件拆分（LobbyDO → lobby-do.ts，GameRoomDO + actions）
3. 安全修复（堆栈泄露、座位 token）
4. 迁移清理
5. setTimeout → alarm
6. 测试 + lint + CI
