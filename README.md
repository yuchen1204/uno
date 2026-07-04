# UNO 在线 - 多人在线卡牌游戏

## 技术栈
- 前端: React + TypeScript + Vite
- 后端: Cloudflare Workers + D1 + KV + Durable Objects
- 部署: Cloudflare Workers（后端+静态资源）

## 本地开发

### 1. 初始化数据库
```bash
cd backend
npx wrangler d1 create uno-db
# 复制输出的 database_id 到 wrangler.jsonc
npx wrangler kv:namespace create UNO_SESSIONS
# 复制输出的 id 到 wrangler.jsonc
```

### 2. 应用数据库迁移
```bash
npx wrangler d1 migrations apply uno-db --local
```

### 3. 启动后端
```bash
npx wrangler dev
```

### 4. 新终端 - 启动前端
```bash
cd ../frontend
npm run dev
```

## 部署
```bash
cd backend && npm run deploy
```

## 项目结构
```
uno/
├── frontend/                   # React 前端
│   ├── src/
│   │   ├── components/         # UI 组件
│   │   ├── styles/             # 样式
│   │   ├── api.ts              # API 客户端
│   │   ├── types.ts            # 类型定义
│   │   └── AuthContext.tsx      # 认证上下文
│   └── ...
├── backend/                    # Cloudflare Workers
│   ├── src/
│   │   ├── index.ts            # Worker 入口 + LobbyDO + GameRoomDO
│   │   ├── auth.ts             # 认证模块
│   │   ├── rooms.ts            # 房间 API
│   │   ├── leaderboard.ts      # 排行榜
│   │   ├── types.ts            # 类型定义
│   │   └── game/               # 游戏逻辑
│   │       ├── deck.ts         # 牌堆
│   │       ├── rules.ts        # 出牌规则
│   │       └── scoring.ts      # 积分
│   └── ...
├── migrations/                 # D1 数据库迁移
│   └── 001_init.sql
└── docs/
    └── superpowers/
        ├── specs/              # 设计文档
        └── plans/              # 实施计划
```

## 房间类型
| 类型 | 房间列表 | 加入方式 | 登录 | 积分 |
|------|---------|---------|------|------|
| 公开 | 显示 | 点击加入 | 需登录 | 累加 |
| 私有 | 不显示 | 输入房间码 | 需登录 | 累加 |
| 快速 | 不显示 | 输入房间码 | 不强制 | 不计 |

## 积分规则
- 出 Skip/Reverse/+2: 即时 +20 分（给被影响的玩家）
- 出 Wild+4: 即时 +50 分（给被影响的玩家）
- 游戏结束: 赢家获得所有对手手牌分值之和
- 数字牌: 面值分
- Skip/Reverse/+2: 20 分（结算时）
- Wild/Wild+4: 50 分（结算时）