# AI 对战模式设计文档

**日期**: 2026-07-08
**状态**: 已批准
**涉及组件**: 后端 game-room-do.ts, rooms.ts, ai-player.ts (新); 前端 GameScreen.tsx, RoomScreen.tsx, api.ts

---

## 1. 概述

在现有 UNO 多人游戏中增加 AI 对手支持。房主可以在房间中**手动添加/移除 AI 对手**，每个 AI 可独立选择三种难度（Easy / Medium / Hard）。AI 作为普通玩家占一个座位，遵循相同的游戏规则，通过后端决策引擎自动出牌。

---

## 2. AI 决策引擎设计

新建 `backend/src/game/ai-player.ts`，包含 AI 决策核心逻辑。

### 2.1 接口

```typescript
export type AiDifficulty = "easy" | "medium" | "hard";

export interface AiDecision {
  action: "play_card" | "draw_card" | "skip_turn";
  cardIndex?: number;       // 出击牌的手牌索引
  comboCardIndex?: number;  // 万能牌连携时，有色牌的手牌索引
  color?: CardColor;        // 出万能牌时选择的颜色
}

export function aiDecide(
  hand: Card[],
  gameState: GameStateRow,
  players: PlayerFull[],
  difficulty: AiDifficulty,
  topCard: Card,
  wildColor?: CardColor
): AiDecision;
```

### 2.2 三种难度策略

#### Easy（随机出牌）
- 如果有可出的牌，随机选一张出
- 如果手牌有万能牌，随机选一个颜色
- 如果没有可出的牌，摸牌
- 不计算 combo，不主动用万能牌连携

#### Medium（规则驱动 + 随机扰动）
- 优先出分数高的牌（+2 > Skip/Reverse > 数字）
- 出万能牌时选择手牌中数量最多的颜色
- 如果手牌有 1 张，优先出分高的牌尽快结束
- 有 ~20% 概率随机选择（非最优，增加变化）
- 会计算 combo（万能牌 + 有色牌连携）
- 保留万能牌到迫不得已再用

#### Hard（最优策略）
- 计算每步最优解：
  1. 优先清手牌：看是否能一次出完
  2. 选择对自己最有利的颜色（基于手中剩余牌的颜色分布）
  3. 选择让对手最不利的颜色（基于对手手牌数量最多的玩家推断）
  4. 完美计算 combo 连携，最大化单次出牌数
  5. 在 draw 惩罚状态下，如果有 +2/+4 一定出
- 无随机性，始终选择评分最高的动作
- 保留万能牌应对紧急情况（如惩罚累计）
- 跳过策略：除非手牌没有可出牌，否则不出 skip

### 2.3 决策流程

```
aiDecide(hand, gameState, players, difficulty):
  1. 获取可出的牌列表 (validCards)
  2. 如果 validCards 为空:
     a. 如果有 draw_accumulated > 0 → 摸牌（吃惩罚）
     b. 否则 → 摸牌
  3. 如果 validCards 非空:
     a. 根据 difficulty 打分选牌
     b. 如果是万能牌 → 选颜色 + 选 combo 牌
     c. 返回 { action: "play_card", cardIndex, comboCardIndex?, color? }
  4. 如果 difficulty 决定不打出牌（Easy 随机概率）→ 摸牌
```

### 2.4 防作弊

AI 决策函数只接收**公开的游戏状态**（手牌是自己的，其他玩家只有手牌数量），不读取对手手牌内容。Hard 模式基于游戏状态推断（如对手手牌数量变化、出牌历史等），不基于"窥视"对手手牌。

---

## 3. 数据模型

### 3.1 players 表新字段

在 `backend/src/game/game-room-do.ts` 的 `CREATE TABLE IF NOT EXISTS players` 中新增：

```sql
ALTER TABLE players ADD COLUMN is_ai INTEGER DEFAULT 0;
ALTER TABLE players ADD COLUMN ai_difficulty TEXT DEFAULT NULL;
```

### 3.2 GameState 新字段

```typescript
// 在 GameState 接口中新增
playerInfo 扩展:
  isAi?: boolean;
  aiDifficulty?: AiDifficulty;
```

---

## 4. 后端逻辑

### 4.1 添加/移除 AI 的 API

在 `backend/src/index.ts` 新增路由：

```
POST /api/game/:code/add-ai  → { difficulty: "easy" | "medium" | "hard" }
POST /api/game/:code/remove-ai → { seatIndex: number }
```

### 4.2 addAi 逻辑（在 GameRoomDOv2 中）

```typescript
async handleAddAi(difficulty: AiDifficulty): Promise<{ success: boolean; seatIndex?: number; error?: string }> {
  // 前置条件：phase === "waiting"，且房间未满
  // 1. 找到第一个空座位
  // 2. 插入玩家记录：is_ai = 1, ai_difficulty = difficulty, username = "AI (Easy/Medium/Hard)"
  // 3. broadcastState()
}
```

### 4.3 removeAi 逻辑

```typescript
async handleRemoveAi(seatIndex: number): Promise<{ success: boolean; error?: string }> {
  // 前置条件：该座位是 AI
  // 1. DELETE FROM players WHERE seat_index = ? AND is_ai = 1
  // 2. broadcastState()
}
```

### 4.4 AI 自动出牌

在 `GameRoomDOv2` 中新增 `processAiTurn()` 方法：

```typescript
async processAiTurn(): Promise<void> {
  const gameState = this.getGameState();
  if (!gameState || gameState.phase !== "playing") return;

  const players = this.getAllPlayers();
  const currentPlayer = players.find(p => p.seatIndex === gameState.current_seat);
  if (!currentPlayer || !currentPlayer.isAi) return;

  const topCard = JSON.parse(gameState.top_card || "{}") as Card;
  const wildColor = gameState.wild_color ? (gameState.wild_color as CardColor) : undefined;

  // AI 决策
  const decision = aiDecide(currentPlayer.hand, gameState, players, currentPlayer.aiDifficulty!, topCard, wildColor);

  // 执行决策（延迟 0.5-2 秒模拟人类思考）
  // 延迟时间根据难度：Easy 0.5-1s, Medium 1-1.5s, Hard 1.5-2s
  const delay = this.getAiDelay(currentPlayer.aiDifficulty!);
  await new Promise(resolve => setTimeout(resolve, delay));

  // 直接调用内部执行逻辑（不通过 playerAction，绕过权限校验）
  this.executeAiDecision(currentPlayer, players, gameState, decision);
}
```

### 4.5 触发 AI 回合

在 `broadcastState()` 或 `advanceToNext()` 后检测：

```typescript
// 在 advanceToNext 或实际游戏状态变更后
if (nextPlayer?.isAi && gameState.phase === "playing") {
  // 使用 setTimeout 或 alarm 机制触发 AI 回合
  this.scheduleAiTurn(nextPlayer.seatIndex);
}
```

**注意**: 使用 `this.ctx.storage.setAlarm()` 来实现 AI 延迟，避免 `setTimeout` 在 DO 中的不可靠性。

### 4.6 AI 不参与离线检查

- AI 玩家的 `connected` 始终为 1
- 在 idle timeout / disconnect 检查中跳过 AI 玩家
- AI 不影响"所有玩家已准备"的判断（自动准备）

---

## 5. 前端逻辑

### 5.1 房间内管理 AI

在 `GameScreen.tsx` 的 `waiting` 阶段：

- 玩家列表中的 AI 玩家显示为 `AI (Easy/Medium/Hard)` 标签
- 房主在 waiting 阶段可以看到"添加 AI"按钮
- 点击后弹出难度选择器（Easy / Medium / Hard）
- 每个 AI 玩家旁边显示"移除"按钮（仅房主可见）
- AI 数量限制：房间满员前可添加，最多 3 个 AI

### 5.2 前端 API 新增

```typescript
// api.ts 新增
addAi(code: string, difficulty: "easy" | "medium" | "hard"): Promise<{ success: boolean; seatIndex?: number }>
removeAi(code: string, seatIndex: number): Promise<{ success: boolean }>
```

### 5.3 游戏内 AI 显示

- AI 玩家在玩家列表中显示难度标签 `AI (Easy/Medium/Hard)`
- AI 玩家的头像/名称使用预设样式（与真人玩家视觉区分）
- AI 玩家的手牌数量正常显示

### 5.4 AI 出牌动画

- AI 出牌时，在操作栏区域显示 "AI 正在思考..." 提示
- 由于 AI 延迟 + 广播，前端通过 SSE 感知状态变化，无需额外处理

---

## 6. 边界情况

| 场景 | 行为 |
|------|------|
| 房主在游戏中添加 AI | 不允许，仅在 waiting 阶段可操作 |
| 游戏进行中，所有真人离开 | AI 自动结束游戏（同现有 leave 逻辑） |
| AI 的回合触发 void proposal | AI 自动拒绝 void proposal |
| 房间只剩 AI 玩家 | AI 之间可以正常对战，真人可旁观 |
| AI 玩家的准备状态 | AI 自动准备（is_ready = 1） |
| 快速房间 + AI | 同普通房间，AI 可以添加 |
| 添加 AI 后房间满员 | 自动触发对局开始？不，仍需要真人准备/开始 |

---

## 7. 实现要点

- **AI 决策是纯函数**：不依赖外部状态，输入手牌和游戏状态即可决策
- **AI 延迟使用 DO alarm**：通过 `setAlarm` 实现延迟，避免 `setTimeout`
- **AI 不占用 SSE 连接**：AI 没有前端，不需要 SSE 流
- **AI 不产生积分**：AI 玩家的积分不记入数据库
- **API 兼容**：新增字段均为可选，旧客户端不受影响
- **测试要点**：三种难度的决策正确性、AI 自动出牌流程、AI 在 void proposal 时的响应