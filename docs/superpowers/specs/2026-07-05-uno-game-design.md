# UNO 多人在线游戏 - 设计文档

## 技术栈

- 前端：React SPA，部署到 Cloudflare Pages
- 后端：Cloudflare Workers + D1 + KV + Durable Objects
- 传输：Streamable HTTP (DO)

## 数据模型

### D1 用户表

```sql
users (
  id          TEXT PRIMARY KEY,             -- UUID
  username    TEXT UNIQUE NOT NULL,         -- 登录用户名，唯一
  password    TEXT NOT NULL,                -- bcrypt 哈希
  score       INTEGER DEFAULT 0,           -- 全局累计积分
  created_at  TEXT NOT NULL                 -- ISO 时间
)
```

### D1 房间表

```sql
rooms (
  code        TEXT PRIMARY KEY,             -- 6位房间码，如 "A3F9KQ"
  type        TEXT NOT NULL,                -- 'public' | 'private' | 'quick'
  host_id     TEXT,                         -- 创建者用户ID（quick房间可能NULL）
  status      TEXT NOT NULL,                -- 'waiting' | 'playing' | 'finished'
  created_at  TEXT NOT NULL,
  finished_at TEXT
)
```

### D1 快速房间匿名玩家

```sql
quick_players (
  room_code   TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  nickname    TEXT NOT NULL,
  PRIMARY KEY (room_code, session_id)
)
```

### KV 命名空间

- `UNO_SESSIONS`：`session:<token>` → `{ userId, username, createdAt, expiresAt }`，TTL 7天
- `QUICK_SESSIONS`：`quick:<token>` → `{ roomCode, nickname }`，TTL 4小时

### 房间类型

| 类型 | 房间列表 | 加入方式 | 登录要求 | 积分累积 |
|------|---------|----------|---------|---------|
| 公开 | 显示在房间列表 | 房间列表点击 | 必须 | 是 |
| 私有 | 不显示 | 链接加入 | 必须 | 是 |
| 快速 | 不显示 | 链接加入 | 不强制 | 否 |

## API 路由

### 认证

- `POST /api/auth/register` — `{ username, password }` → `{ token, username }`
- `POST /api/auth/login` — `{ username, password }` → `{ token, username }`
- `GET /api/auth/me` — Header `Authorization: Bearer <token>` → `{ username, score }`

### 房间

- `POST /api/rooms` — `{ type, nickname? }` → `{ code }`
- `GET /api/rooms` — 公开房间列表
- `GET /api/rooms/:code` — 房间详情
- `GET /api/rooms/:code/join` — 加入房间，返回 GameRoomDO stub URL

### 游戏（Streamable HTTP）

- `POST /api/game/:code/action` — `{ action, cardIndex?, color? }` → 游戏状态更新
- `GET /api/game/:code/stream` — 长连接，推送游戏状态变更
- `POST /api/game/:code/start` — 房主开始

### 积分 & 排行榜

- `GET /api/leaderboard` — `SELECT username, score FROM users ORDER BY score DESC LIMIT 100`

## Durable Objects 设计

### LobbyDO (单实例)

- 维护公开房间列表（将 status='waiting' 的公开房间加载到内存）
- 提供 `listRooms()` RPC
- 房间创建/状态变更时通知更新

### GameRoomDO (每个活跃房间一个实例)

实例命名：`getByName(roomCode)`

#### SQLite 表

```sql
room_config (
  code TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  max_players INTEGER DEFAULT 4,
  min_players INTEGER DEFAULT 2,
  status TEXT NOT NULL
)

players (
  seat_index INTEGER PRIMARY KEY,
  user_id TEXT,
  username TEXT NOT NULL,
  hand TEXT NOT NULL,           -- JSON: 手牌数组
  is_host INTEGER DEFAULT 0,
  connected INTEGER DEFAULT 1,
  joined_at TEXT NOT NULL
)

game_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  phase TEXT NOT NULL DEFAULT 'waiting',
  current_seat INTEGER,
  direction INTEGER DEFAULT 1,
  top_card TEXT,
  deck TEXT NOT NULL,
  discard_pile TEXT NOT NULL,
  wild_color TEXT,
  draw_accumulated INTEGER DEFAULT 0,
  winner_seat INTEGER
)
```

## 牌型定义

| 牌型 | 数量 | 颜色 |
|------|------|------|
| 数字 0 | 4 (每色1张) | 红黄蓝绿 |
| 数字 1-9 | 72 (每色2张) | 红黄蓝绿 |
| Skip | 8 (每色2张) | 红黄蓝绿 |
| Reverse | 8 (每色2张) | 红黄蓝绿 |
| +2 | 8 (每色2张) | 红黄蓝绿 |
| Wild | 4 | 万能 |
| Wild +4 | 4 | 万能 |
| **总计** | **108** | |

## 核心游戏逻辑

### 初始化
1. 108 张牌随机洗牌
2. 每人发 7 张
3. 翻开牌堆顶第一张作为起始牌（如果是 Wild+4 则放回重翻）
4. 设置当前玩家为座位 0

### 出牌
- 颜色匹配 (Wild/万能通配)
- 数字匹配
- 符号匹配 (Skip/Reverse/+2)

Wild +4 限制：如果手牌中有任何与当前顶牌颜色匹配的非万能牌，则不能出 Wild+4。

### 特效牌处理

| 牌 | 效果 |
|---|------|
| Skip | 跳过下一个玩家 |
| Reverse | 反转方向（2人局等同 Skip） |
| +2 | 下家抽 2 张并跳过回合；如果下家出 +2 则累加 |
| Wild | 出牌者选颜色 |
| Wild +4 | 出牌者选颜色，下家抽 4 张并跳过回合（不能累加 +2） |

### 出牌积分

每次打出特效牌时，出牌者获得积分：
- Skip: +20 分
- Reverse: +20 分
- +2: +20 分
- Wild: +50 分
- Wild +4: +50 分
- 数字牌: 0 分

玩家摸牌不产生积分变化。

### 游戏结束

当某个玩家手牌数为 0 时：
1. 该玩家获胜
2. 计算所有剩余玩家手牌的罚分
3. 获胜者获得所有罚分之和，累加至其全局积分（仅公开/私有房间）
4. 更新 D1 用户积分

罚分规则：
- 数字牌：面值分数
- Skip/Reverse/+2：20 分
- Wild：50 分
- Wild +4：50 分

### 玩家断线

- 30 秒无操作判定断线（`connected` 标记为 0）
- 断线玩家轮到行动时自动抽牌并跳过
- 重连后恢复 `connected` 标记

### 牌堆耗尽

若牌堆抽完，将弃牌堆（除顶牌外）洗回牌堆。

## 前端页面结构

```
页模式布局，非路由：
- LoginScreen: 检测无 session → 弹出登录/注册窗口
- LobbyScreen: 房间列表 + 创建房间按钮
- GameScreen: 游戏界面（手牌、弃牌堆、玩家列表、操作按钮）
```

### 登录/注册窗口

- 用户名 + 密码输入
- 切换登录/注册模式
- 输入框下方显示错误提示（用户名已存在、密码错误等）

### 房间列表

- 显示公开房间：房间码、人数、状态
- 创建房间按钮 → 弹出选择房间类型
- 私有/快速房间需要输入房间码或点击邀请链接加入

### 游戏界面

- 中央：弃牌堆（顶牌大图显示） + 牌堆
- 底部：自己的手牌（可点击选择）
- 左右/上方：其他玩家（用户名、手牌数量）
- 状态栏：当前轮到谁、方向指示
- 操作按钮：出牌、抽牌、UNO 声明
- 选择颜色面板（出 Wild 时弹出）

## 前端数据流

1. 初始加载检测 local storage token → `GET /api/auth/me`
2. 无 token → 显示登录/注册弹窗
3. 创建/加入房间 → 获取房间码
4. 进入游戏 → `GET /api/game/:code/stream` 建立长连接
5. 玩家行动 → `POST /api/game/:code/action` 直接返回结果
6. Stream 推送 → 更新 UI