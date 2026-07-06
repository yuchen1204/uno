# UNO 在线 - 多人在线卡牌游戏

基于 Cloudflare Workers 的全栈多人在线 UNO 卡牌游戏。

## 技术栈

- **前端**: React 19 + TypeScript + Vite
- **后端**: Cloudflare Workers + D1 (SQLite) + KV + Durable Objects
- **部署**: Cloudflare Workers（后端 + 前端静态资源）

## 功能

- 在线实时多人对战（2-4人）
- 三种房间模式：**公开**（需登录，有积分）/ **私有**（需登录，有积分）/ **快速**（不强制登录，无积分）
- 完整 UNO 规则：功能牌、罚牌、连携出牌、UNO 声明、拼点系统
- Server-Sent Events 实时状态同步
- 用户注册/登录系统
- 排行榜

## 本地开发

### 前置要求

- Node.js 18+
- npm

### 1. 安装依赖

```bash
cd frontend && npm install
cd ../backend && npm install
```

### 2. 创建 Cloudflare 资源（首次）

```bash
cd backend
npx wrangler d1 create uno-db
# 复制输出的 database_id 到 backend/wrangler.jsonc
npx wrangler kv:namespace create SESSIONS
# 复制输出的 id 到 backend/wrangler.jsonc
```

### 3. 应用数据库迁移

```bash
cd backend
npx wrangler d1 migrations apply uno-db --local
```

### 4. 启动后端

```bash
cd backend
npx wrangler dev
```

### 5. 新终端 - 启动前端

```bash
cd frontend
npm run dev
```

前端默认运行在 `http://localhost:5173`，后端在 `http://localhost:8787`。

## 部署

```bash
cd frontend && npm run build    # 构建前端到 frontend/dist/
cd ../backend && npm run deploy # 部署后端 + 前端静态资源到 Cloudflare
```

## 项目结构

```
uno/
├── frontend/                       # React 前端
│   ├── src/
│   │   ├── components/             # UI 组件
│   │   │   ├── Card.tsx            # 卡牌渲染
│   │   │   ├── ColorPicker.tsx     # 颜色选择器（万能牌）
│   │   │   ├── ConfirmModal.tsx    # 确认弹窗
│   │   │   ├── CreateRoomModal.tsx # 创建房间弹窗
│   │   │   ├── DiscardPile.tsx     # 弃牌堆
│   │   │   ├── GameScreen.tsx      # 游戏主界面
│   │   │   ├── Leaderboard.tsx     # 排行榜
│   │   │   ├── LoginModal.tsx      # 登录/注册弹窗
│   │   │   ├── PlayerHand.tsx      # 玩家手牌
│   │   │   └── PlayerList.tsx      # 玩家列表
│   │   ├── styles/                 # CSS 样式
│   │   ├── api.ts                  # API 客户端
│   │   ├── types.ts                # 类型定义
│   │   ├── AuthContext.tsx          # 认证上下文
│   │   └── App.tsx                 # 应用入口
│   └── vite.config.ts
├── backend/                        # Cloudflare Worker
│   ├── src/
│   │   ├── index.ts                # Worker 入口 + LobbyDO + GameRoomDO
│   │   ├── auth.ts                 # 用户认证（bcrypt + KV Session）
│   │   ├── rooms.ts                # 房间 CRUD API
│   │   ├── leaderboard.ts          # 排行榜 API
│   │   ├── types.ts                # 共享类型
│   │   └── game/
│   │       ├── deck.ts             # 牌堆生成与洗牌
│   │       ├── rules.ts            # 出牌规则验证
│   │       └── scoring.ts          # 积分计算
│   └── wrangler.jsonc              # Worker 配置
├── migrations/                     # D1 数据库迁移
│   └── 001_init.sql
└── docs/
    └── superpowers/
        ├── specs/                  # 设计文档
        └── plans/                  # 实施计划
```

## 房间类型

| 类型 | 房间列表 | 加入方式 | 登录 | 积分 |
|------|---------|---------|------|------|
| 公开 | 显示在列表 | 点击加入 | 需要登录 | 累加 |
| 私有 | 不显示 | 输入房间码 | 需要登录 | 累加 |
| 快速 | 不显示 | 输入房间码 | 不强制 | 不计分 |

## 积分规则

- 游戏结束赢家获得所有对手手牌分值之和
- 出 Skip/Reverse/+2: 即时 +20 分
- 出 Wild+4: 即时 +50 分
- 结算时手牌分值：数字牌 = 面值，Skip/Reverse/+2 = 20 分，Wild/Wild+4 = 50 分

## 游戏机制

- **连携出牌**: 万能牌必须搭配一张有色牌一起出
- **罚牌防守**: +2 和 +4 可以累积传递，防守方必须出同类型罚牌或摸走累积罚牌
- **拼点系统**: 连携出牌后下家必须出相同颜色且数字大于等于连携牌的牌
- **跳回合限制**: 每名玩家最多连续跳过 3 回合
- **UNO 声明**: 出到剩 1 张牌时自动 UNO

## 许可证

MIT