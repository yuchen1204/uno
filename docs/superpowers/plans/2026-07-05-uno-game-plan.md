# UNO 多人在线游戏 - 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个多人在线 UNO 卡牌游戏，包含注册登录、房间系统、即时游戏和排行榜。

**Architecture:** React 前端部署到 Cloudflare Pages，Workers 作为 API Gateway 处理认证/房间/游戏路由，D1 存储用户和房间数据，KV 存储会话令牌，Durable Objects（LobbyDO + GameRoomDO）处理实时游戏逻辑和房间列表。

**Tech Stack:** React + TypeScript, Cloudflare Workers, D1, KV, Durable Objects (SQLite), Streamable HTTP, Wrangler

---

## 文件结构

```
uno/
├── frontend/                    # React SPA
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx               # 根组件 + 路由/模式切换
│       ├── api.ts                # 后端 API 封装
│       ├── types.ts              # 共享类型定义
│       ├── AuthContext.tsx        # 认证上下文 + token 管理
│       ├── components/
│       │   ├── LoginModal.tsx     # 登录/注册弹窗
│       │   ├── Lobby.tsx         # 大厅（房间列表 + 创建）
│       │   ├── CreateRoomModal.tsx
│       │   ├── GameScreen.tsx    # 游戏主界面
│       │   ├── PlayerHand.tsx    # 玩家手牌
│       │   ├── Card.tsx          # 单张牌渲染
│       │   ├── DiscardPile.tsx   # 弃牌堆
│       │   ├── PlayerList.tsx    # 玩家列表
│       │   ├── ColorPicker.tsx   # 选颜色弹窗
│       │   └── Leaderboard.tsx   # 排行榜
│       └── styles/
│           └── uno.css           # 全局样式
│
├── backend/                     # Cloudflare Workers
│   ├── package.json
│   ├── wrangler.jsonc            # Worker 配置
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts              # Worker 入口 + 路由分发
│       ├── auth.ts               # 注册/登录/me 处理
│       ├── rooms.ts              # 房间 CRUD API
│       ├── leaderboard.ts        # 排行榜 API
│       ├── middleware.ts         # 认证中间件
│       ├── types.ts              # 共享类型
│       ├── do/
│       │   ├── LobbyDO.ts        # 房间列表管理 DO
│       │   └── GameRoomDO.ts     # 游戏逻辑 DO
│       └── game/
│           ├── deck.ts           # 牌堆生成、洗牌
│           ├── rules.ts          # 出牌规则判断
│           └── scoring.ts        # 积分计算
│
├── migrations/
│   └── 001_init.sql              # D1 初始表结构
│
└── docs/
    └── superpowers/
        ├── specs/
        │   └── 2026-07-05-uno-game-design.md
        └── plans/
            └── 2026-07-05-uno-game-plan.md
```

### Task 1: 项目脚手架 + Worker 配置

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/wrangler.jsonc`
- Create: `backend/src/index.ts`

- [ ] **Step 1: 创建 backend 目录和 package.json**

```json
{
  "name": "uno-backend",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250614.0",
    "@types/bcryptjs": "^2.4.6",
    "@types/uuid": "^10.0.0",
    "typescript": "^5.5.0",
    "wrangler": "^3.100.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 创建 wrangler.jsonc**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "uno-backend",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-05",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "../frontend/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "uno-db",
      "database_id": "PLACEHOLDER_DB_ID"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "SESSIONS",
      "id": "PLACEHOLDER_KV_ID"
    }
  ],
  "durable_objects": {
    "bindings": [
      { "name": "LOBBY_DO", "class_name": "LobbyDO" },
      { "name": "GAME_ROOM_DO", "class_name": "GameRoomDO" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["LobbyDO", "GameRoomDO"] }
  ]
}
```

- [ ] **Step 4: 创建 Worker 入口 src/index.ts**（骨架，后续填充路由）

```typescript
import { DurableObject } from "cloudflare:workers";

export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  LOBBY_DO: DurableObjectNamespace<LobbyDO>;
  GAME_ROOM_DO: DurableObjectNamespace<GameRoomDO>;
}

export class LobbyDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS public_rooms (
          code TEXT PRIMARY KEY,
          player_count INTEGER DEFAULT 1,
          max_players INTEGER DEFAULT 4,
          created_at TEXT NOT NULL
        )
      `);
    });
  }

  async listRooms(): Promise<{ code: string; playerCount: number; maxPlayers: number }[]> {
    const cursor = this.ctx.storage.sql.exec<{
      code: string;
      player_count: number;
      max_players: number;
    }>("SELECT code, player_count, max_players FROM public_rooms ORDER BY created_at DESC");
    return cursor.toArray().map(r => ({
      code: r.code,
      playerCount: r.player_count,
      maxPlayers: r.max_players,
    }));
  }

  async addRoom(code: string, maxPlayers: number): Promise<void> {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO public_rooms (code, player_count, max_players, created_at) VALUES (?, 1, ?, ?)",
      code,
      maxPlayers,
      new Date().toISOString(),
    );
  }

  async removeRoom(code: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM public_rooms WHERE code = ?", code);
  }

  async updatePlayerCount(code: string, count: number): Promise<void> {
    this.ctx.storage.sql.exec(
      "UPDATE public_rooms SET player_count = ? WHERE code = ?",
      count,
      code,
    );
  }
}

export class GameRoomDO extends DurableObject<Env> { }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/auth/register") return handleRegister(request, env);
    if (pathname === "/api/auth/login") return handleLogin(request, env);
    if (pathname === "/api/auth/me") return handleMe(request, env);
    if (pathname === "/api/rooms" && request.method === "POST") return handleCreateRoom(request, env);
    if (pathname === "/api/rooms" && request.method === "GET") return handleListRooms(request, env);
    if (pathname.startsWith("/api/rooms/")) return handleRoomDetail(request, env, pathname);
    if (pathname === "/api/leaderboard") return handleLeaderboard(request, env);
    if (pathname.startsWith("/api/game/")) return handleGame(request, env, pathname);

    return new Response("Not Found", { status: 404 });
  },
};
```

- [ ] **Step 5: 创建 migrations/001_init.sql**

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  host_id TEXT,
  status TEXT NOT NULL DEFAULT 'waiting',
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS quick_players (
  room_code TEXT NOT NULL,
  session_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  PRIMARY KEY (room_code, session_id)
);
```

- [ ] **Step 6: 安装依赖**

Run: `cd backend && npm install`
Expected: 所有依赖安装成功，无报错

- [ ] **Step 7: 运行类型检查**

Run: `cd backend && npx tsc --noEmit`
Expected: 类型检查通过

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "chore: scaffold backend project structure with Worker config"
```

### Task 2: 认证模块（auth.ts + 路由集成）

**Files:**
- Create: `backend/src/types.ts`
- Create: `backend/src/auth.ts`
- Modify: `backend/src/index.ts`（集成 auth 处理函数）

- [ ] **Step 1: 创建 types.ts**

```typescript
export interface User {
  id: string;
  username: string;
  password: string;
  score: number;
  created_at: string;
}

export interface Session {
  userId: string;
  username: string;
  createdAt: string;
  expiresAt: string;
}

export interface Room {
  code: string;
  type: "public" | "private" | "quick";
  host_id: string | null;
  status: "waiting" | "playing" | "finished";
  created_at: string;
  finished_at?: string;
}

export interface QuickPlayer {
  room_code: string;
  session_id: string;
  nickname: string;
}

export type CardColor = "red" | "yellow" | "blue" | "green";
export type CardType = "number" | "skip" | "reverse" | "draw2" | "wild" | "wild4";

export interface Card {
  color?: CardColor;
  type: CardType;
  value?: number; // 0-9 for number cards
}

export interface GameState {
  phase: "waiting" | "playing" | "finished";
  currentSeat: number;
  direction: 1 | -1;
  topCard: Card;
  deckCount: number;
  wildColor?: CardColor;
  drawAccumulated: number;
  winnerSeat?: number;
  players: PlayerInfo[];
}

export interface PlayerInfo {
  seatIndex: number;
  username: string;
  handCount: number;
  isHost: boolean;
  connected: boolean;
  score: number;
}

export interface PlayerFull {
  seatIndex: number;
  user_id: string | null;
  username: string;
  hand: Card[];
  isHost: boolean;
  connected: boolean;
  score: number;
}
```

- [ ] **Step 2: 创建 auth.ts**

```typescript
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { Env, Session } from "./types";

function generateToken(): string {
  return uuidv4().replace(/-/g, "") + uuidv4().replace(/-/g, "");
}

async function createSession(userId: string, username: string, env: Env): Promise<string> {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const session: Session = {
    userId,
    username,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  await env.SESSIONS.put(`session:${token}`, JSON.stringify(session), {
    expirationTtl: 7 * 24 * 60 * 60,
  });
  return token;
}

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  try {
    const { username, password } = await request.json<{ username: string; password: string }>();
    if (!username || !password || username.length < 2 || password.length < 4) {
      return Response.json({ error: "用户名至少2字符，密码至少4字符" }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9_\u4e00-\u9fff]+$/.test(username)) {
      return Response.json({ error: "用户名只能包含字母、数字、下划线和中文" }, { status: 400 });
    }

    const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
      .bind(username)
      .first();
    if (existing) {
      return Response.json({ error: "用户名已存在" }, { status: 409 });
    }

    const id = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();

    await env.DB.prepare(
      "INSERT INTO users (id, username, password, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(id, username, hashedPassword, now)
      .run();

    const token = await createSession(id, username, env);
    return Response.json({ token, username, score: 0 });
  } catch (e) {
    return Response.json({ error: "注册失败" }, { status: 500 });
  }
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  try {
    const { username, password } = await request.json<{ username: string; password: string }>();
    const user = await env.DB.prepare("SELECT * FROM users WHERE username = ?")
      .bind(username)
      .first<{ id: string; username: string; password: string; score: number }>();
    if (!user) {
      return Response.json({ error: "用户名或密码错误" }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return Response.json({ error: "用户名或密码错误" }, { status: 401 });
    }

    const token = await createSession(user.id, user.username, env);
    return Response.json({ token, username: user.username, score: user.score });
  } catch (e) {
    return Response.json({ error: "登录失败" }, { status: 500 });
  }
}

export async function handleMe(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }
  const token = authHeader.slice(7);
  const sessionRaw = await env.SESSIONS.get(`session:${token}`);
  if (!sessionRaw) {
    return Response.json({ error: "会话已过期" }, { status: 401 });
  }
  const session: Session = JSON.parse(sessionRaw);
  const user = await env.DB.prepare("SELECT username, score FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ username: string; score: number }>();
  if (!user) {
    return Response.json({ error: "用户不存在" }, { status: 404 });
  }
  return Response.json({ username: user.username, score: user.score });
}

export async function authenticateRequest(request: Request, env: Env): Promise<{ userId: string; username: string } | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const sessionRaw = await env.SESSIONS.get(`session:${token}`);
  if (!sessionRaw) return null;
  const session: Session = JSON.parse(sessionRaw);
  return { userId: session.userId, username: session.username };
}
```

- [ ] **Step 3: 修改 index.ts 引入认证处理**

在 index.ts 顶部添加导入：
```typescript
import { handleRegister, handleLogin, handleMe } from "./auth";
```

确保 `export default { async fetch(...) }` 中的路由处理函数已占位。

- [ ] **Step 4: 类型检查**

Run: `cd backend && npx tsc --noEmit`
Expected: 类型检查通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: add auth module with register, login, session management"
```

### Task 3: 房间系统 API（创建、列出、查询、加入）

**Files:**
- Create: `backend/src/rooms.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: 创建 rooms.ts**

```typescript
import { v4 as uuidv4 } from "uuid";
import { Env } from "./types";
import { authenticateRequest } from "./auth";

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function handleCreateRoom(request: Request, env: Env): Promise<Response> {
  try {
    const { type, nickname } = await request.json<{ type: "public" | "private" | "quick"; nickname?: string }>();
    if (!["public", "private", "quick"].includes(type)) {
      return Response.json({ error: "无效的房间类型" }, { status: 400 });
    }

    // 公开和私有房间必须登录
    let userId: string | null = null;
    let username = "Guest";
    if (type !== "quick") {
      const user = await authenticateRequest(request, env);
      if (!user) {
        return Response.json({ error: "需要登录" }, { status: 401 });
      }
      userId = user.userId;
      username = user.username;
    } else {
      // 快速房间：允许自定义标识符
      if (!nickname || nickname.trim().length === 0) {
        return Response.json({ error: "快速房间需要设置用户标识符" }, { status: 400 });
      }
      username = nickname.trim();
      // 为快速房间创建临时会话
      const tempToken = uuidv4().replace(/-/g, "");
      await env.SESSIONS.put(`quick:${tempToken}`, JSON.stringify({ nickname: username }), {
        expirationTtl: 4 * 60 * 60,
      });
    }

    const code = generateRoomCode();
    const now = new Date().toISOString();

    await env.DB.prepare(
      "INSERT INTO rooms (code, type, host_id, status, created_at) VALUES (?, ?, ?, 'waiting', ?)"
    ).bind(code, type, userId, now).run();

    // 公开房间通知 LobbyDO
    if (type === "public") {
      const lobbyId = env.LOBBY_DO.idFromName("global");
      const lobbyStub = env.LOBBY_DO.get(lobbyId);
      await lobbyStub.addRoom(code, 4);
    }

    return Response.json({ code, type, hostName: username });
  } catch (e) {
    return Response.json({ error: "创建房间失败" }, { status: 500 });
  }
}

export async function handleListRooms(request: Request, env: Env): Promise<Response> {
  try {
    const lobbyId = env.LOBBY_DO.idFromName("global");
    const lobbyStub = env.LOBBY_DO.get(lobbyId);
    const rooms = await lobbyStub.listRooms();
    return Response.json({ rooms });
  } catch (e) {
    return Response.json({ error: "获取房间列表失败" }, { status: 500 });
  }
}

export async function handleRoomDetail(request: Request, env: Env, pathname: string): Promise<Response> {
  const parts = pathname.split("/");
  // /api/rooms/:code or /api/rooms/:code/join
  const code = parts[3];
  if (!code || code.length !== 6) {
    return Response.json({ error: "无效的房间码" }, { status: 400 });
  }

  if (parts[4] === "join") {
    return handleJoinRoom(code, request, env);
  }

  // GET /api/rooms/:code
  const room = await env.DB.prepare("SELECT * FROM rooms WHERE code = ?")
    .bind(code)
    .first<{ code: string; type: string; host_id: string | null; status: string; created_at: string }>();
  if (!room) {
    return Response.json({ error: "房间不存在" }, { status: 404 });
  }

  return Response.json({
    code: room.code,
    type: room.type,
    status: room.status,
    created_at: room.created_at,
  });
}

async function handleJoinRoom(code: string, request: Request, env: Env): Promise<Response> {
  const room = await env.DB.prepare("SELECT * FROM rooms WHERE code = ?")
    .bind(code)
    .first<{ code: string; type: string; status: string }>();
  if (!room) {
    return Response.json({ error: "房间不存在" }, { status: 404 });
  }
  if (room.status !== "waiting") {
    return Response.json({ error: "游戏已开始或已结束" }, { status: 400 });
  }

  let userId: string | null = null;
  let username: string;

  if (room.type !== "quick") {
    const user = await authenticateRequest(request, env);
    if (!user) {
      return Response.json({ error: "需要登录" }, { status: 401 });
    }
    userId = user.userId;
    username = user.username;
  } else {
    // 快速房间：允许带昵称参数或从 header 获取
    const nick = request.headers.get("X-Uno-Nickname") || "Guest";
    username = nick;
  }

  // 返回 GameRoomDO 加入信息
  const gameRoomId = env.GAME_ROOM_DO.idFromName(code);
  const gameStub = env.GAME_ROOM_DO.get(gameRoomId);
  const joinResult = await gameStub.joinGame(username, userId);

  // 更新 LobbyDO 玩家人数
  if (room.type === "public") {
    const lobbyId = env.LOBBY_DO.idFromName("global");
    const lobbyStub = env.LOBBY_DO.get(lobbyId);
    await lobbyStub.updatePlayerCount(code, joinResult.playerCount);
  }

  return Response.json({ ...joinResult, code });
}
```

- [ ] **Step 2: 修改 index.ts 导入房间处理函数**

```typescript
import { handleCreateRoom, handleListRooms, handleRoomDetail } from "./rooms";
```

- [ ] **Step 3: 类型检查**

Run: `cd backend && npx tsc --noEmit`
Expected: 类型检查通过

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "feat: add room system API with create/list/join"
```

### Task 4: GameRoomDO 游戏逻辑核心（牌堆、出牌规则、积分）

**Files:**
- Create: `backend/src/game/deck.ts`
- Create: `backend/src/game/rules.ts`
- Create: `backend/src/game/scoring.ts`

- [ ] **Step 1: 创建 deck.ts**

```typescript
import { Card, CardColor, CardType } from "../types";

const COLORS: CardColor[] = ["red", "yellow", "blue", "green"];

export function createDeck(): Card[] {
  const deck: Card[] = [];

  for (const color of COLORS) {
    // 0 每色1张
    deck.push({ color, type: "number", value: 0 });

    // 1-9 每色2张
    for (let v = 1; v <= 9; v++) {
      deck.push({ color, type: "number", value: v });
      deck.push({ color, type: "number", value: v });
    }

    // Skip, Reverse, +2 每色2张
    for (const type of ["skip", "reverse", "draw2"] as CardType[]) {
      deck.push({ color, type });
      deck.push({ color, type });
    }
  }

  // Wild, Wild+4 各4张
  for (let i = 0; i < 4; i++) {
    deck.push({ type: "wild" });
    deck.push({ type: "wild4" });
  }

  return deck;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function dealCards(deck: Card[], count: number): { cards: Card[]; remaining: Card[] } {
  const cards = deck.slice(0, count);
  const remaining = deck.slice(count);
  return { cards, remaining };
}

export function cardToScore(card: Card): number {
  if (card.type === "number" && card.value !== undefined) return card.value;
  if (card.type === "skip" || card.type === "reverse" || card.type === "draw2") return 20;
  if (card.type === "wild" || card.type === "wild4") return 50;
  return 0;
}

export function cardToActionScore(card: Card): number {
  if (card.type === "skip" || card.type === "reverse") return 20;
  if (card.type === "draw2") return 20;
  if (card.type === "wild4") return 50;
  return 0;
}
```

- [ ] **Step 2: 创建 rules.ts**

```typescript
import { Card, CardColor } from "../types";

export function canPlayCard(card: Card, topCard: Card, hand: Card[], wildColor?: CardColor): boolean {
  // Wild 万能牌总是可以出
  if (card.type === "wild") return true;

  // Wild+4 限制：如果手牌中有匹配当前顶牌颜色的非万能牌则不能出
  if (card.type === "wild4") {
    const matchingColor = topCard.color || wildColor;
    if (matchingColor) {
      const hasColorMatch = hand.some(
        c => c.type !== "wild4" && c.type !== "wild" && (c.color === matchingColor || c.color === topCard.color)
      );
      if (hasColorMatch) return false;
    }
    return true;
  }

  // 颜色匹配
  const effectiveColor = wildColor || topCard.color;
  if (card.color === effectiveColor) return true;

  // 数字匹配
  if (card.type === "number" && topCard.type === "number" && card.value === topCard.value) return true;

  // 符号匹配
  if (card.type !== "number" && topCard.type !== "number" && card.type === topCard.type) return true;

  return false;
}

export function getEffectiveTopCard(topCard: Card, wildColor?: CardColor): Card {
  if (topCard.type === "wild" || topCard.type === "wild4") {
    return { ...topCard, color: wildColor };
  }
  return topCard;
}
```

- [ ] **Step 3: 创建 scoring.ts**

```typescript
import { Card } from "../types";
import { cardToScore, cardToActionScore } from "./deck";

export function calculateHandScore(hand: Card[]): number {
  return hand.reduce((sum, card) => sum + cardToScore(card), 0);
}

export function calculateActionScore(card: Card): number {
  return cardToActionScore(card);
}
```

- [ ] **Step 4: 类型检查**

Run: `cd backend && npx tsc --noEmit`
Expected: 类型检查通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: add game core logic - deck, rules, scoring"
```

### Task 5: GameRoomDO 完整实现（游戏状态管理、回合控制、WS 流推送）

**Files:**
- Modify: `backend/src/index.ts`（填充 GameRoomDO）
- Modify: `backend/src/game/deck.ts`（暴露更多函数）

- [ ] **Step 1: 实现 GameRoomDO**

在 GameRoomDO class 中实现完整游戏逻辑：

```typescript
import { DurableObject } from "cloudflare:workers";
import { Env, Card, CardColor, GameState, PlayerFull, PlayerInfo } from "../types";
import { createDeck, shuffleDeck, dealCards, cardToScore, cardToActionScore } from "../game/deck";
import { canPlayCard } from "../game/rules";
import { calculateHandScore, calculateActionScore } from "../game/scoring";

export class GameRoomDO extends DurableObject<Env> {
  pendingStreams: ReadableStreamController[] = [];
  disconnectTimers: Map<number, number> = new Map();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room_config (
          code TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          max_players INTEGER DEFAULT 4,
          min_players INTEGER DEFAULT 2,
          status TEXT NOT NULL DEFAULT 'waiting'
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS players (
          seat_index INTEGER PRIMARY KEY,
          user_id TEXT,
          username TEXT NOT NULL,
          hand TEXT NOT NULL DEFAULT '[]',
          is_host INTEGER DEFAULT 0,
          connected INTEGER DEFAULT 1,
          score INTEGER DEFAULT 0,
          joined_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS game_state (
          id INTEGER PRIMARY KEY DEFAULT 1,
          phase TEXT NOT NULL DEFAULT 'waiting',
          current_seat INTEGER,
          direction INTEGER DEFAULT 1,
          top_card TEXT,
          deck TEXT NOT NULL DEFAULT '[]',
          discard_pile TEXT NOT NULL DEFAULT '[]',
          wild_color TEXT,
          draw_accumulated INTEGER DEFAULT 0,
          winner_seat INTEGER
        )
      `);
    });
  }

  async joinGame(username: string, userId: string | null): Promise<{ seatIndex: number; playerCount: number }> {
    const config = this.ctx.storage.sql.exec("SELECT * FROM room_config").one() as any;
    if (!config || config.status !== "waiting") throw new Error("房间不可加入");

    const existingPlayers = this.ctx.storage.sql.exec(
      "SELECT seat_index, user_id FROM players ORDER BY seat_index"
    ).toArray() as any[];
    const maxPlayers = config.max_players;
    if (existingPlayers.length >= maxPlayers) throw new Error("房间已满");

    // 查找空座位
    const usedSeats = new Set(existingPlayers.map((p: any) => p.seat_index));
    let seatIndex = 0;
    while (usedSeats.has(seatIndex)) seatIndex++;

    const now = new Date().toISOString();
    const isHost = seatIndex === 0;
    this.ctx.storage.sql.exec(
      "INSERT INTO players (seat_index, user_id, username, hand, is_host, joined_at) VALUES (?, ?, ?, '[]', ?, ?)",
      seatIndex,
      userId,
      username,
      isHost ? 1 : 0,
      now,
    );

    this.broadcastState();
    return { seatIndex, playerCount: existingPlayers.length + 1 };
  }

  async startGame(): Promise<{ success: boolean; error?: string }> {
    const config = this.ctx.storage.sql.exec("SELECT * FROM room_config").one() as any;
    if (!config) return { success: false, error: "房间未初始化" };

    const players = this.ctx.storage.sql.exec(
      "SELECT * FROM players ORDER BY seat_index"
    ).toArray() as any[];
    if (players.length < config.min_players) {
      return { success: false, error: "玩家人数不足" };
    }

    // 初始化牌堆
    let deck = shuffleDeck(createDeck());

    // 发牌：每人7张
    for (const player of players) {
      const { cards, remaining } = dealCards(deck, 7);
      deck = remaining;
      this.ctx.storage.sql.exec(
        "UPDATE players SET hand = ? WHERE seat_index = ?",
        JSON.stringify(cards),
        player.seat_index,
      );
    }

    // 翻起始牌（不能是 Wild+4）
    let topCard: Card;
    do {
      topCard = deck[0];
      deck = deck.slice(1);
    } while (topCard.type === "wild4");

    // 如果起始牌是 Wild，随机选颜色
    let wildColor: CardColor | undefined;
    if (topCard.type === "wild") {
      wildColor = (["red", "yellow", "blue", "green"] as CardColor[])[Math.floor(Math.random() * 4)];
    }

    this.ctx.storage.sql.exec(
      "UPDATE game_state SET phase = 'playing', current_seat = 0, direction = 1, top_card = ?, deck = ?, discard_pile = '[]', wild_color = ?, draw_accumulated = 0 WHERE id = 1",
      JSON.stringify(topCard),
      JSON.stringify(deck),
      wildColor || null,
    );

    // 更新房间状态
    this.ctx.storage.sql.exec("UPDATE room_config SET status = 'playing' WHERE code = ?", config.code);
    await this.updateD1RoomStatus(config.code, "playing");

    this.broadcastState();
    return { success: true };
  }

  async playerAction(seatIndex: number, action: string, payload?: any): Promise<{ success: boolean; error?: string; scoreChange?: number; targetSeat?: number }> {
    const gameState = this.getGameState();
    if (!gameState || gameState.phase !== "playing") {
      return { success: false, error: "游戏未进行中" };
    }
    if (gameState.currentSeat !== seatIndex) {
      return { success: false, error: "不是你的回合" };
    }

    const players = this.getAllPlayers();
    const player = players.find(p => p.seatIndex === seatIndex);
    if (!player) return { success: false, error: "玩家不存在" };

    if (action === "draw_card") {
      return this.handleDrawCard(player, players, gameState);
    } else if (action === "play_card") {
      return this.handlePlayCard(player, players, gameState, payload);
    } else if (action === "say_uno") {
      return { success: true }; // UNO 声明只是标记，无服务器校验
    }
    return { success: false, error: "无效操作" };
  }

  private handleDrawCard(player: PlayerFull, players: PlayerFull[], state: any): { success: boolean; error?: string; scoreChange?: number } {
    const deck = JSON.parse(state.deck) as Card[];
    const wildColor = state.wild_color ? (state.wild_color as CardColor) : undefined;
    const topCard = JSON.parse(state.top_card) as Card;

    // 如果手牌中有可出的牌，不能直接摸牌（标准规则：摸牌后如果能出则自动出）
    const canPlay = player.hand.some(c => canPlayCard(c, topCard, player.hand, wildColor));
    if (canPlay) {
      return { success: false, error: "你还有可出的牌，不能摸牌" };
    }

    // 摸一张牌
    if (deck.length === 0) {
      return { success: false, error: "牌堆已空" };
    }
    const drawnCard = deck[0];
    const newDeck = deck.slice(1);
    const newHand = [...player.hand, drawnCard];

    this.updatePlayerHand(player.seatIndex, newHand);
    this.updateDeck(newDeck);

    // 检查摸到的牌能否出
    if (canPlayCard(drawnCard, topCard, [drawnCard], wildColor)) {
      // 自动出牌
      const playCard = newHand.pop()!;
      return this.executePlayCard(player, players, state, playCard, { seatIndex: player.seatIndex, hand: newHand, deck: newDeck, topCard, wildColor });
    }

    // 不能出，跳过回合
    this.advanceToNext(state);
    this.broadcastState();
    return { success: true };
  }

  handlePlayCard(player: PlayerFull, players: PlayerFull[], state: any, payload: { cardIndex: number; color?: CardColor }): { success: boolean; error?: string; scoreChange?: number; targetSeat?: number } {
    const card = player.hand[payload.cardIndex];
    if (!card) return { success: false, error: "无效的牌" };

    const wildColor = state.wild_color ? (state.wild_color as CardColor) : undefined;
    const topCard = JSON.parse(state.top_card) as Card;

    if (!canPlayCard(card, topCard, player.hand, wildColor)) {
      return { success: false, error: "不能出这张牌" };
    }

    return this.executePlayCard(player, players, state, card, { seatIndex: player.seatIndex, hand: player.hand, deck: JSON.parse(state.deck), topCard, wildColor, chosenColor: payload.color });
  }

  private executePlayCard(
    player: PlayerFull, players: PlayerFull[], state: any, card: Card,
    ctx: { seatIndex: number; hand: Card[]; deck: Card[]; topCard: Card; wildColor?: CardColor; chosenColor?: CardColor }
  ): { success: boolean; error?: string; scoreChange?: number; targetSeat?: number } {
    const newHand = ctx.hand.filter((_, i) => i !== 0 || ctx.hand.indexOf(card) !== 0);
    // 简单移除：实际应根据 card 引用或比较
    const handIndex = newHand.findIndex(c => c === card);
    // 更可靠的移除
    const filteredHand = ctx.hand.filter((_, i) => {
      if (card.type === "number" && card.value !== undefined) {
        return !(ctx.hand[i].type === "number" && ctx.hand[i].value === card.value && ctx.hand[i].color === card.color);
      }
      if (card.type === "wild" || card.type === "wild4") {
        return !(ctx.hand[i].type === card.type);
      }
      return !(ctx.hand[i].type === card.type && ctx.hand[i].color === card.color);
    });

    this.updatePlayerHand(player.seatIndex, filteredHand);

    let newDeck = ctx.deck;
    let discardPile = JSON.parse(state.discard_pile) as Card[];
    discardPile.push(ctx.topCard);

    // 处理特效
    let nextSeat = this.getNextSeat(ctx.seatIndex, state.direction, players);
    let newDirection = state.direction;
    let drawAccumulated = state.draw_accumulated || 0;
    let scoreChange = 0;
    let targetSeat: number | undefined;
    let wildColor = ctx.wildColor;
    let skipAfter = false;

    if (card.type === "skip") {
      targetSeat = nextSeat;
      scoreChange = 20;
      skipAfter = true;
    } else if (card.type === "reverse") {
      newDirection = (state.direction * -1) as 1 | -1;
      if (players.length === 2) {
        targetSeat = nextSeat;
        scoreChange = 20;
        skipAfter = true;
      }
    } else if (card.type === "draw2") {
      targetSeat = nextSeat;
      scoreChange = 20;
      this.drawCards(nextSeat, 2);
      skipAfter = true;
    } else if (card.type === "wild") {
      wildColor = ctx.chosenColor;
    } else if (card.type === "wild4") {
      targetSeat = nextSeat;
      scoreChange = 50;
      this.drawCards(nextSeat, 4);
      wildColor = ctx.chosenColor;
      skipAfter = true;
    }

    // 更新游戏状态
    const updatedState = {
      direction: newDirection,
      current_seat: skipAfter ? this.getNextSeat(nextSeat, newDirection, players) : nextSeat,
      top_card: JSON.stringify(card),
      deck: JSON.stringify(newDeck),
      discard_pile: JSON.stringify(discardPile),
      wild_color: wildColor || null,
      draw_accumulated: 0,
    };

    this.ctx.storage.sql.exec(
      "UPDATE game_state SET phase = 'playing', current_seat = ?, direction = ?, top_card = ?, deck = ?, discard_pile = ?, wild_color = ?, draw_accumulated = ? WHERE id = 1",
      updatedState.current_seat,
      updatedState.direction,
      updatedState.top_card,
      updatedState.deck,
      updatedState.discard_pile,
      updatedState.wild_color,
      updatedState.draw_accumulated,
    );

    // 检查是否有人赢了
    if (filteredHand.length === 0) {
      this.finishGame(player.seatIndex, players, cardToScore(card), scoreChange);
      return { success: true, scoreChange, targetSeat };
    }

    // 即时积分
    if (targetSeat !== undefined && scoreChange > 0 && this.env) {
      // 为对手加分（使用 RPC 通知 D1）
      this.addScoreToTarget(targetSeat, scoreChange, players);
    }

    this.broadcastState();
    return { success: true, scoreChange, targetSeat };
  }

  private getNextSeat(current: number, direction: 1 | -1, players: PlayerFull[]): number {
    const seats = players.map(p => p.seatIndex).sort((a, b) => a - b);
    const idx = seats.indexOf(current);
    if (idx === -1) return seats[0];
    const nextIdx = (idx + direction + seats.length) % seats.length;
    return seats[nextIdx];
  }

  private drawCards(seatIndex: number, count: number): void {
    const player = this.getAllPlayers().find(p => p.seatIndex === seatIndex);
    if (!player) return;
    const deck = JSON.parse(this.ctx.storage.sql.exec("SELECT deck FROM game_state WHERE id = 1").one().deck as string) as Card[];
    const drawn = deck.slice(0, count);
    const newDeck = deck.slice(count);
    const newHand = [...player.hand, ...drawn];
    this.updatePlayerHand(seatIndex, newHand);
    this.updateDeck(newDeck);
  }

  private async finishGame(winnerSeat: number, players: PlayerFull[], finalCardScore: number, actionScore: number): Promise<void> {
    let totalScore = finalCardScore + actionScore;
    for (const p of players) {
      if (p.seatIndex !== winnerSeat) {
        totalScore += calculateHandScore(p.hand);
      }
    }

    this.ctx.storage.sql.exec(
      "UPDATE game_state SET phase = 'finished', winner_seat = ? WHERE id = 1",
      winnerSeat,
    );
    this.ctx.storage.sql.exec("UPDATE room_config SET status = 'finished' WHERE code = ?", this.getRoomCode());

    // 更新全局积分（仅非快速房间）
    const config = this.ctx.storage.sql.exec("SELECT type FROM room_config").one() as any;
    if (config && config.type !== "quick" && this.env) {
      const winner = players.find(p => p.seatIndex === winnerSeat);
      if (winner?.user_id) {
        try {
          await this.env.DB.prepare("UPDATE users SET score = score + ? WHERE id = ?")
            .bind(totalScore, winner.user_id)
            .run();
        } catch (e) {
          // D1 调用可能失败，但不需要阻止游戏结束
        }
      }
    }

    await this.updateD1RoomStatus(this.getRoomCode(), "finished");
    this.broadcastState();
  }

  private addScoreToTarget(seatIndex: number, amount: number, players: PlayerFull[]): void {
    const player = players.find(p => p.seatIndex === seatIndex);
    if (player?.user_id && this.env) {
      this.env.DB.prepare("UPDATE users SET score = score + ? WHERE id = ?")
        .bind(amount, player.user_id)
        .run()
        .catch(() => {}); // 静默失败，游戏逻辑优先
    }
  }

  private getRoomCode(): string {
    const config = this.ctx.storage.sql.exec("SELECT code FROM room_config").one() as any;
    return config?.code || "";
  }

  private async updateD1RoomStatus(code: string, status: string): Promise<void> {
    if (this.env) {
      this.env.DB.prepare("UPDATE rooms SET status = ? WHERE code = ?")
        .bind(status, code)
        .run()
        .catch(() => {});
    }
  }

  // ---- 便捷查询方法 ----

  private getGameState(): any {
    const row = this.ctx.storage.sql.exec("SELECT * FROM game_state WHERE id = 1").one() as any;
    return row || null;
  }

  private getAllPlayers(): PlayerFull[] {
    const rows = this.ctx.storage.sql.exec("SELECT * FROM players ORDER BY seat_index").toArray() as any[];
    return rows.map(r => ({
      seatIndex: r.seat_index,
      user_id: r.user_id,
      username: r.username,
      hand: JSON.parse(r.hand),
      isHost: r.is_host === 1,
      connected: r.connected === 1,
      score: r.score,
    }));
  }

  private updatePlayerHand(seatIndex: number, hand: Card[]): void {
    this.ctx.storage.sql.exec(
      "UPDATE players SET hand = ? WHERE seat_index = ?",
      JSON.stringify(hand),
      seatIndex,
    );
  }

  private updateDeck(deck: Card[]): void {
    this.ctx.storage.sql.exec(
      "UPDATE game_state SET deck = ? WHERE id = 1",
      JSON.stringify(deck),
    );
  }

  private advanceToNext(state: any): void {
    const players = this.getAllPlayers();
    const nextSeat = this.getNextSeat(state.current_seat, state.direction, players);
    this.ctx.storage.sql.exec(
      "UPDATE game_state SET current_seat = ? WHERE id = 1",
      nextSeat,
    );
  }

  // ---- Streamable HTTP / State Broadcasting ----

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Stream endpoint
    if (pathname.endsWith("/stream")) {
      const { readable, writable } = new TransformStream<Uint8Array>();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // 立即发送当前状态
      const state = this.getFullStateForPlayer(-1); // -1 means no player-specific hand
      writer.write(encoder.encode(JSON.stringify(state) + "\n"));

      // 注册推送
      this.pendingStreams.push(writable as any);
      request.signal.onabort = () => {
        const idx = this.pendingStreams.indexOf(writable as any);
        if (idx >= 0) this.pendingStreams.splice(idx, 1);
        writer.close().catch(() => {});
      };

      return new Response(readable, {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  }

  // RPC 方法
  async getFullStateForPlayer(seatIndex: number): Promise<GameState> {
    const gameState = this.getGameState();
    const players = this.getAllPlayers();
    const currentPlayer = seatIndex >= 0 ? players.find(p => p.seatIndex === seatIndex) : null;

    return {
      phase: gameState?.phase || "waiting",
      currentSeat: gameState?.current_seat,
      direction: gameState?.direction,
      topCard: JSON.parse(gameState?.top_card || "{}"),
      deckCount: JSON.parse(gameState?.deck || "[]").length,
      wildColor: gameState?.wild_color,
      drawAccumulated: gameState?.draw_accumulated,
      winnerSeat: gameState?.winner_seat,
      players: players.map(p => ({
        seatIndex: p.seatIndex,
        username: p.username,
        handCount: p.hand.length,
        isHost: p.isHost,
        connected: p.connected,
        score: p.score,
      })),
    };
  }

  private broadcastState(): void {
    if (this.pendingStreams.length === 0) return;
    const state = this.getFullStateForPlayer(-1);
    const data = JSON.stringify(state) + "\n";
    const encoder = new TextEncoder();
    const message = encoder.encode(data);
    for (const stream of this.pendingStreams) {
      try {
        stream.enqueue(message);
      } catch (e) {
        // stream closed
      }
    }
    // 清理已关闭的流
    this.pendingStreams = this.pendingStreams.filter(s => {
      try {
        s.enqueue(message);
        return true;
      } catch {
        return false;
      }
    });
  }
}
```

- [ ] **Step 2: 在 index.ts 中添加 game 路由处理**

创建 `handleGame` 函数：

```typescript
async function handleGame(request: Request, env: Env, pathname: string): Promise<Response> {
  const parts = pathname.split("/");
  // /api/game/:code/:action
  const code = parts[3];
  const action = parts[4];

  if (!code || code.length !== 6) {
    return Response.json({ error: "无效的房间码" }, { status: 400 });
  }

  const gameRoomId = env.GAME_ROOM_DO.idFromName(code);
  const stub = env.GAME_ROOM_DO.get(gameRoomId);

  if (action === "state") {
    // 获取游戏状态，需要认证
    const user = await authenticateRequest(request, env);
    const nick = request.headers.get("X-Uno-Nickname");
    const state = await stub.getFullStateForPlayer(-1);
    return Response.json(state);
  }

  if (action === "start") {
    // 房主开始游戏
    const result = await stub.startGame();
    return Response.json(result);
  }

  if (action === "action") {
    // 玩家行动
    const body = await request.json<{ seatIndex: number; action: string; cardIndex?: number; color?: CardColor }>();
    const result = await stub.playerAction(body.seatIndex, body.action, { cardIndex: body.cardIndex, color: body.color });
    return Response.json(result);
  }

  if (action === "stream") {
    // 转发到 DO 的 stream 端点
    return stub.fetch(request);
  }

  return Response.json({ error: "无效的游戏操作" }, { status: 400 });
}
```

- [ ] **Step 3: 确保 index.ts 导入函数**

```typescript
import { handleCreateRoom, handleListRooms, handleRoomDetail } from "./rooms";
import { handleRegister, handleLogin, handleMe, authenticateRequest } from "./auth";
import { CardColor } from "./types";
```

- [ ] **Step 4: 完善 index.ts 中 handleGame 路由**

替换占位 `if (pathname.startsWith("/api/game/"))` 为调用 `handleGame`。

- [ ] **Step 5: 类型检查**

Run: `cd backend && npx tsc --noEmit`
Expected: 类型检查通过（可能需要修复报错）

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat: implement GameRoomDO with full game state, card rules, scoring, and streaming"
```

### Task 6: 排行榜 API

**Files:**
- Create: `backend/src/leaderboard.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: 创建 leaderboard.ts**

```typescript
import { Env } from "./types";

export async function handleLeaderboard(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 200);

  const rows = await env.DB.prepare(
    "SELECT username, score FROM users ORDER BY score DESC LIMIT ?"
  ).bind(limit).all<{ username: string; score: number }>();

  return Response.json({ leaderboard: rows.results });
}
```

- [ ] **Step 2: 修改 index.ts 添加导入和路由**

```typescript
import { handleLeaderboard } from "./leaderboard";
```

- [ ] **Step 3: 类型检查**

Run: `cd backend && npx tsc --noEmit`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "feat: add leaderboard API"
```

### Task 7: 前端脚手架（React + Vite + Cloudflare Pages）

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/api.ts`
- Create: `frontend/src/types.ts`
- Create: `frontend/src/AuthContext.tsx`
- Create: `frontend/src/styles/uno.css`

- [ ] **Step 1: 创建 frontend/package.json**

```json
{
  "name": "uno-frontend",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: 创建 vite.config.ts**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
});
```

- [ ] **Step 3: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: 创建 tsconfig.node.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: 创建 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>UNO 在线</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 6: 创建 src/types.ts**

```typescript
export interface User {
  username: string;
  score: number;
}

export interface AuthResponse {
  token: string;
  username: string;
  score: number;
}

export type RoomType = "public" | "private" | "quick";

export interface Room {
  code: string;
  type: RoomType;
  status: "waiting" | "playing" | "finished";
  playerCount?: number;
  maxPlayers?: number;
}

export type CardColor = "red" | "yellow" | "blue" | "green";
export type CardType = "number" | "skip" | "reverse" | "draw2" | "wild" | "wild4";

export interface Card {
  color?: CardColor;
  type: CardType;
  value?: number;
}

export interface PlayerInfo {
  seatIndex: number;
  username: string;
  handCount: number;
  isHost: boolean;
  connected: boolean;
  score: number;
}

export interface GameState {
  phase: "waiting" | "playing" | "finished";
  currentSeat: number;
  direction: 1 | -1;
  topCard: Card;
  deckCount: number;
  wildColor?: CardColor;
  drawAccumulated: number;
  winnerSeat?: number;
  players: PlayerInfo[];
}

export interface LeaderboardEntry {
  username: string;
  score: number;
}
```

- [ ] **Step 7: 创建 src/api.ts**

```typescript
import { AuthResponse, Room, GameState, LeaderboardEntry, CardColor } from "./types";

const API_BASE = "/api";

function getToken(): string | null {
  return localStorage.getItem("uno_token");
}

function setToken(token: string): void {
  localStorage.setItem("uno_token", token);
}

function clearToken(): void {
  localStorage.removeItem("uno_token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

export const api = {
  // Auth
  register(username: string, password: string): Promise<AuthResponse> {
    return request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },

  login(username: string, password: string): Promise<AuthResponse> {
    return request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },

  me(): Promise<{ username: string; score: number }> {
    return request("/auth/me");
  },

  isLoggedIn(): boolean {
    return !!getToken();
  },

  setToken(token: string): void {
    setToken(token);
  },

  clearToken(): void {
    clearToken();
  },

  // Rooms
  createRoom(type: "public" | "private" | "quick", nickname?: string): Promise<{ code: string; type: string; hostName: string }> {
    return request("/rooms", {
      method: "POST",
      body: JSON.stringify({ type, nickname }),
    });
  },

  listRooms(): Promise<{ rooms: { code: string; playerCount: number; maxPlayers: number }[] }> {
    return request("/rooms");
  },

  getRoom(code: string): Promise<Room> {
    return request(`/rooms/${code}`);
  },

  joinRoom(code: string): Promise<{ seatIndex: number; playerCount: number }> {
    return request(`/rooms/${code}/join`, { method: "GET" });
  },

  // Game
  getGameState(code: string): Promise<GameState> {
    return request(`/game/${code}/state`);
  },

  startGame(code: string): Promise<{ success: boolean; error?: string }> {
    return request(`/game/${code}/start`, { method: "POST" });
  },

  playerAction(code: string, seatIndex: number, action: string, cardIndex?: number, color?: CardColor): Promise<any> {
    return request(`/game/${code}/action`, {
      method: "POST",
      body: JSON.stringify({ seatIndex, action, cardIndex, color }),
    });
  },

  // Stream
  createGameStream(code: string): EventSource {
    // 使用 fetch + ReadableStream 做长连接会更通用
    // 但简易方案用 EventSource 风格
    const es = new EventSource(`${API_BASE}/game/${code}/stream`);
    return es;
  },

  // Leaderboard
  getLeaderboard(limit?: number): Promise<{ leaderboard: LeaderboardEntry[] }> {
    const query = limit ? `?limit=${limit}` : "";
    return request(`/leaderboard${query}`);
  },
};
```

- [ ] **Step 8: 创建 src/AuthContext.tsx**

```tsx
import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { api } from "./api";
import { User } from "./types";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (api.isLoggedIn()) {
      api.me()
        .then(u => setUser(u))
        .catch(() => {
          api.clearToken();
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username: string, password: string) => {
    const res = await api.login(username, password);
    api.setToken(res.token);
    setUser({ username: res.username, score: res.score });
  };

  const register = async (username: string, password: string) => {
    const res = await api.register(username, password);
    api.setToken(res.token);
    setUser({ username: res.username, score: res.score });
  };

  const logout = () => {
    api.clearToken();
    setUser(null);
  };

  const refreshUser = async () => {
    try {
      const u = await api.me();
      setUser(u);
    } catch {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

- [ ] **Step 9: 创建 src/main.tsx**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./AuthContext";
import App from "./App";
import "./styles/uno.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);
```

- [ ] **Step 10: 创建 src/App.tsx（骨架）**

```tsx
import { useState } from "react";
import { useAuth } from "./AuthContext";
import LoginModal from "./components/LoginModal";
import Lobby from "./components/Lobby";
import GameScreen from "./components/GameScreen";
import Leaderboard from "./components/Leaderboard";

export default function App() {
  const { user, loading } = useAuth();
  const [page, setPage] = useState<"lobby" | "game" | "leaderboard">("lobby");
  const [roomCode, setRoomCode] = useState<string | null>(null);

  if (loading) return <div className="loading">加载中...</div>;

  return (
    <div className="app">
      <header className="app-header">
        <h1>UNO</h1>
        <nav>
          <button onClick={() => setPage("lobby")}>大厅</button>
          <button onClick={() => setPage("leaderboard")}>排行榜</button>
          {user && <span className="user-info">{user.username} ({user.score}分)</span>}
        </nav>
      </header>

      <main className="app-main">
        {page === "lobby" && (
          <Lobby
            onJoinGame={(code) => {
              setRoomCode(code);
              setPage("game");
            }}
          />
        )}
        {page === "game" && roomCode && (
          <GameScreen
            code={roomCode}
            onLeave={() => {
              setRoomCode(null);
              setPage("lobby");
            }}
          />
        )}
        {page === "leaderboard" && <Leaderboard />}
      </main>
    </div>
  );
}
```

- [ ] **Step 11: 创建 src/styles/uno.css**（基础样式）

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #1a1a2e;
  color: #eee;
  min-height: 100vh;
}

.app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #333;
  margin-bottom: 24px;
}

.app-header h1 {
  font-size: 28px;
  color: #e94560;
}

.app-header nav {
  display: flex;
  gap: 12px;
  align-items: center;
}

.app-header button {
  background: #16213e;
  color: #eee;
  border: 1px solid #333;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
}

.app-header button:hover {
  background: #0f3460;
}

.user-info {
  color: #aaa;
  font-size: 14px;
}

.loading {
  text-align: center;
  padding: 40px;
  color: #666;
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: #16213e;
  padding: 32px;
  border-radius: 12px;
  min-width: 320px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}

.modal h2 {
  margin-bottom: 20px;
  color: #e94560;
}

.modal input {
  display: block;
  width: 100%;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: #1a1a2e;
  border: 1px solid #333;
  border-radius: 6px;
  color: #eee;
  font-size: 16px;
}

.modal button {
  width: 100%;
  padding: 10px;
  background: #e94560;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 16px;
  cursor: pointer;
  margin-bottom: 8px;
}

.modal button.secondary {
  background: transparent;
  border: 1px solid #e94560;
  color: #e94560;
}

.error {
  color: #e94560;
  font-size: 14px;
  margin-bottom: 8px;
}

/* Lobby */
.lobby {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 24px;
}

.room-list {
  background: #16213e;
  border-radius: 12px;
  padding: 20px;
}

.room-list h2 {
  margin-bottom: 16px;
}

.room-item {
  display: flex;
  justify-content: space-between;
  padding: 12px;
  border: 1px solid #333;
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.room-item:hover {
  background: #0f3460;
}

.room-code {
  font-family: monospace;
  font-size: 18px;
  font-weight: bold;
}

.sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sidebar button {
  padding: 14px;
  font-size: 16px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  background: #0f3460;
  color: #eee;
}

.sidebar button.primary {
  background: #e94560;
  color: white;
}

/* Game */
.game-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

.game-table {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  width: 100%;
}

.players-top {
  display: flex;
  gap: 32px;
  justify-content: center;
}

.player-info {
  text-align: center;
  padding: 12px 20px;
  background: #16213e;
  border-radius: 8px;
  min-width: 100px;
}

.player-info.active {
  border: 2px solid #e94560;
}

.player-info .name { font-size: 16px; font-weight: bold; }
.player-info .cards { font-size: 12px; color: #888; }

.center-area {
  display: flex;
  gap: 32px;
  align-items: center;
}

.discard-pile {
  width: 100px;
  height: 140px;
  border: 2px solid #555;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}

.deck {
  width: 100px;
  height: 140px;
  background: #e94560;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 14px;
}

.player-hand {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
  padding: 16px;
  background: #16213e;
  border-radius: 12px;
  min-height: 140px;
}

.card {
  width: 80px;
  height: 120px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 18px;
  cursor: pointer;
  transition: transform 0.2s;
  border: 2px solid rgba(255,255,255,0.1);
  position: relative;
}

.card:hover {
  transform: translateY(-12px);
}

.card.red { background: #e94560; }
.card.yellow { background: #f5a623; }
.card.blue { background: #4361ee; }
.card.green { background: #2ec4b6; }
.card.wild { background: linear-gradient(135deg, #e94560, #f5a623, #4361ee, #2ec4b6); }

.card .value { font-size: 22px; color: white; }

/* Color picker */
.color-picker {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.color-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
}

.color-btn:hover { border-color: white; }
.color-btn.red { background: #e94560; }
.color-btn.yellow { background: #f5a623; }
.color-btn.blue { background: #4361ee; }
.color-btn.green { background: #2ec4b6; }

/* Leaderboard */
.leaderboard {
  max-width: 600px;
  margin: 0 auto;
}

.leaderboard table {
  width: 100%;
  border-collapse: collapse;
}

.leaderboard th, .leaderboard td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid #333;
}

.leaderboard th {
  color: #e94560;
  font-size: 14px;
}

.rank {
  width: 40px;
  text-align: center;
  font-weight: bold;
}

.rank.gold { color: #f5a623; }
.rank.silver { color: #aaa; }
.rank.bronze { color: #cd7f32; }
```

- [ ] **Step 12: 安装前端依赖**

Run: `cd frontend && npm install`
Expected: 依赖安装成功

- [ ] **Step 13: 构建前端测试**

Run: `cd frontend && npx tsc --noEmit && npx vite build`
Expected: 构建成功，dist/ 目录生成

- [ ] **Step 14: 提交**

```bash
git add -A
git commit -m "feat: scaffold React frontend with auth, API client, types, and styles"
```

### Task 8: 前端组件 - LoginModal + Lobby + CreateRoomModal

**Files:**
- Create: `frontend/src/components/LoginModal.tsx`
- Create: `frontend/src/components/Lobby.tsx`
- Create: `frontend/src/components/CreateRoomModal.tsx`

- [ ] **Step 1: 创建 LoginModal.tsx**

```tsx
import { useState } from "react";
import { useAuth } from "../AuthContext";

export default function LoginModal() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "login") {
        await login(username, password);
      } else {
        await register(username, password);
      }
    } catch (err: any) {
      setError(err.message || "操作失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>{mode === "login" ? "登录" : "注册"}</h2>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="用户名"
            value={username}
            onChange={e => setUsername(e.target.value)}
            disabled={loading}
            autoFocus
          />
          <input
            type="password"
            placeholder="密码"
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={loading}
          />
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? "处理中..." : mode === "login" ? "登录" : "注册"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
          >
            {mode === "login" ? "没有账号？去注册" : "已有账号？去登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 CreateRoomModal.tsx**

```tsx
import { useState } from "react";
import { api } from "../api";
import { RoomType } from "../types";

interface Props {
  onClose: () => void;
  onCreated: (code: string) => void;
}

export default function CreateRoomModal({ onClose, onCreated }: Props) {
  const [type, setType] = useState<RoomType>("public");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setError("");
    if (type === "quick" && !nickname.trim()) {
      setError("快速房间需要设置用户标识符");
      return;
    }
    setLoading(true);
    try {
      const result = await api.createRoom(type, type === "quick" ? nickname : undefined);
      onCreated(result.code);
    } catch (err: any) {
      setError(err.message || "创建失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>创建房间</h2>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", marginBottom: 8 }}>
            <input type="radio" checked={type === "public"} onChange={() => setType("public")} />
            公开房间（显示在房间列表）
          </label>
          <label style={{ display: "block", marginBottom: 8 }}>
            <input type="radio" checked={type === "private"} onChange={() => setType("private")} />
            私有房间（仅链接加入，需登录）
          </label>
          <label style={{ display: "block", marginBottom: 8 }}>
            <input type="radio" checked={type === "quick"} onChange={() => setType("quick")} />
            快速房间（仅链接加入，不登录，不积分的 mock data）
          </label>
          <label style={{ display: "block", marginBottom: 8 }}>
            <input type="radio" checked={type === "quick"} onChange={() => setType("quick")} />
            快速房间（仅链接加入，不登录，不积分）
          </label>
        </div>

        {type === "quick" && (
          <input
            type="text"
            placeholder="输入你的昵称（其他人将看到这个名字）"
            value={nickname}
            onChange={e => setNickname(e.target.value)}
          />
        )}

        {error && <div className="error">{error}</div>}

        <button onClick={handleCreate} disabled={loading}>
          {loading ? "创建中..." : "创建"}
        </button>
        <button className="secondary" onClick={onClose}>取消</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 创建 Lobby.tsx**

```tsx
import { useState, useEffect } from "react";
import { useAuth } from "../AuthContext";
import { api } from "../api";
import LoginModal from "./LoginModal";
import CreateRoomModal from "./CreateRoomModal";

interface Props {
  onJoinGame: (code: string) => void;
}

export default function Lobby({ onJoinGame }: Props) {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<{ code: string; playerCount: number; maxPlayers: number }[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");

  const loadRooms = async () => {
    try {
      const res = await api.listRooms();
      setRooms(res.rooms);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadRooms();
    const interval = setInterval(loadRooms, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleJoinByCode = async () => {
    if (!joinCode.trim()) return;
    setError("");
    try {
      await api.joinRoom(joinCode.trim().toUpperCase());
      onJoinGame(joinCode.trim().toUpperCase());
    } catch (err: any) {
      setError(err.message || "加入失败");
    }
  };

  if (!user) return <LoginModal />;

  return (
    <>
      <div className="lobby">
        <div className="room-list">
          <h2>公开房间</h2>
          {rooms.length === 0 ? (
            <p style={{ color: "#666" }}>暂无公开房间，创建一个吧</p>
          ) : (
            rooms.map(room => (
              <div
                key={room.code}
                className="room-item"
                onClick={async () => {
                  try {
                    await api.joinRoom(room.code);
                    onJoinGame(room.code);
                  } catch (err: any) {
                    setError(err.message);
                  }
                }}
              >
                <span className="room-code">{room.code}</span>
                <span>{room.playerCount}/{room.maxPlayers} 人</span>
              </div>
            ))
          )}
        </div>

        <div className="sidebar">
          <button className="primary" onClick={() => setShowCreate(true)}>
            创建房间
          </button>

          <div style={{ borderTop: "1px solid #333", paddingTop: 16 }}>
            <h3>输入房间码加入</h3>
            <input
              type="text"
              placeholder="6位房间码"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
              style={{
                display: "block",
                width: "100%",
                padding: 10,
                marginBottom: 8,
                background: "#1a1a2e",
                border: "1px solid #333",
                borderRadius: 6,
                color: "#eee",
                fontSize: 18,
                fontFamily: "monospace",
                textAlign: "center",
              }}
            />
            <button onClick={handleJoinByCode} style={{ width: "100%" }}>
              加入
            </button>
          </div>

          {error && <div className="error">{error}</div>}
        </div>
      </div>

      {showCreate && (
        <CreateRoomModal
          onClose={() => setShowCreate(false)}
          onCreated={(code) => {
            setShowCreate(false);
            onJoinGame(code);
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: add LoginModal, Lobby, CreateRoomModal components"
```

### Task 9: 前端游戏组件（GameScreen、Card、PlayerHand、ColorPicker）

**Files:**
- Create: `frontend/src/components/GameScreen.tsx`
- Create: `frontend/src/components/Card.tsx`
- Create: `frontend/src/components/PlayerHand.tsx`
- Create: `frontend/src/components/DiscardPile.tsx`
- Create: `frontend/src/components/PlayerList.tsx`
- Create: `frontend/src/components/ColorPicker.tsx`
- Create: `frontend/src/components/Leaderboard.tsx`

- [ ] **Step 1: 创建 Card.tsx**

```tsx
import { Card as CardType, CardColor } from "../types";

interface Props {
  card: CardType;
  onClick?: () => void;
  small?: boolean;
}

const COLOR_LABELS: Record<CardColor, string> = {
  red: "红", yellow: "黄", blue: "蓝", green: "绿",
};

function getCardLabel(card: CardType): string {
  if (card.type === "number" && card.value !== undefined) return String(card.value);
  const labels: Record<string, string> = {
    skip: "跳", reverse: "反", draw2: "+2", wild: "变", wild4: "+4",
  };
  return labels[card.type] || "?";
}

function getCardColor(card: CardType): string {
  if (card.type === "wild" || card.type === "wild4") return "wild";
  return card.color || "wild";
}

export default function CardComponent({ card, onClick, small }: Props) {
  const style: React.CSSProperties = small
    ? { width: 56, height: 84, fontSize: 14 }
    : {};

  return (
    <div
      className={`card ${getCardColor(card)}`}
      style={style}
      onClick={onClick}
    >
      <div className="value">{getCardLabel(card)}</div>
      {card.color && (
        <div style={{ fontSize: 10, opacity: 0.7 }}>
          {COLOR_LABELS[card.color]}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 创建 PlayerHand.tsx**

```tsx
import { Card as CardType } from "../types";
import CardComponent from "./Card";

interface Props {
  cards: CardType[];
  onPlayCard: (index: number) => void;
  disabled?: boolean;
}

export default function PlayerHand({ cards, onPlayCard, disabled }: Props) {
  return (
    <div className="player-hand">
      {cards.map((card, i) => (
        <CardComponent
          key={`${card.color || "wild"}-${card.type}-${card.value ?? ""}-${i}`}
          card={card}
          onClick={() => !disabled && onPlayCard(i)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 创建 DiscardPile.tsx**

```tsx
import { Card } from "../types";
import CardComponent from "./Card";

interface Props {
  card?: Card;
}

export default function DiscardPile({ card }: Props) {
  return (
    <div className="discard-pile">
      {card ? <CardComponent card={card} /> : <span style={{ color: "#888" }}>空</span>}
    </div>
  );
}
```

- [ ] **Step 4: 创建 PlayerList.tsx**

```tsx
import { PlayerInfo } from "../types";

interface Props {
  players: PlayerInfo[];
  currentSeat: number;
  localSeat: number;
}

export default function PlayerList({ players, currentSeat, localSeat }: Props) {
  const otherPlayers = players.filter(p => p.seatIndex !== localSeat);
  const localPlayer = players.find(p => p.seatIndex === localSeat);

  return (
    <>
      <div className="players-top">
        {otherPlayers.map(p => (
          <div key={p.seatIndex} className={`player-info ${p.seatIndex === currentSeat ? "active" : ""}`}>
            <div className="name">{p.username} {p.isHost ? "👑" : ""}</div>
            <div className="cards">{p.handCount} 张牌</div>
            <div style={{ fontSize: 12, color: "#666" }}>座位 {p.seatIndex + 1}</div>
          </div>
        ))}
      </div>
      {localPlayer && (
        <div className="player-info" style={{ marginTop: 8 }}>
          <div className="name">{localPlayer.username} (你) {localPlayer.isHost ? "👑" : ""}</div>
          <div className="cards">{localPlayer.handCount} 张牌</div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 5: 创建 ColorPicker.tsx**

```tsx
import { CardColor } from "../types";

interface Props {
  onSelect: (color: CardColor) => void;
}

const COLORS: { color: CardColor; label: string }[] = [
  { color: "red", label: "红" },
  { color: "yellow", label: "黄" },
  { color: "blue", label: "蓝" },
  { color: "green", label: "绿" },
];

export default function ColorPicker({ onSelect }: Props) {
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ textAlign: "center" }}>
        <h2>选择颜色</h2>
        <div className="color-picker">
          {COLORS.map(c => (
            <button
              key={c.color}
              className={`color-btn ${c.color}`}
              onClick={() => onSelect(c.color)}
              title={c.label}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 创建 Leaderboard.tsx**

```tsx
import { useState, useEffect } from "react";
import { api } from "../api";
import { LeaderboardEntry } from "../types";

function getRankClass(index: number): string {
  if (index === 0) return "gold";
  if (index === 1) return "silver";
  if (index === 2) return "bronze";
  return "";
}

export default function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getLeaderboard(100)
      .then(res => setEntries(res.leaderboard))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">加载中...</div>;

  return (
    <div className="leaderboard">
      <h2>排行榜</h2>
      {entries.length === 0 ? (
        <p style={{ textAlign: "center", color: "#666" }}>暂无数据</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>排名</th>
              <th>玩家</th>
              <th>积分</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={e.username}>
                <td className={`rank ${getRankClass(i)}`}>{i + 1}</td>
                <td>{e.username}</td>
                <td>{e.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 7: 创建 GameScreen.tsx**（完整游戏界面）

```tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../AuthContext";
import { api } from "../api";
import { GameState, Card as CardType, CardColor } from "../types";
import PlayerHand from "./PlayerHand";
import DiscardPile from "./DiscardPile";
import PlayerList from "./PlayerList";
import ColorPicker from "./ColorPicker";

interface Props {
  code: string;
  onLeave: () => void;
}

export default function GameScreen({ code, onLeave }: Props) {
  const { user } = useAuth();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [localSeat, setLocalSeat] = useState<number>(-1);
  const [hand, setHand] = useState<CardType[]>([]);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [pendingCardIndex, setPendingCardIndex] = useState<number>(-1);
  const [error, setError] = useState("");
  const streamRef = useRef<AbortController | null>(null);

  const joinAndStream = async () => {
    try {
      const joinRes = await api.joinRoom(code);
      setLocalSeat(joinRes.seatIndex);

      const state = await api.getGameState(code);
      setGameState(state);

      // 建立流连接
      const controller = new AbortController();
      streamRef.current = controller;

      const response = await fetch(`/api/game/${code}/stream`, {
        signal: controller.signal,
        headers: {
          ...(user ? { Authorization: `Bearer ${localStorage.getItem("uno_token")}` } : {}),
        },
      });

      const reader = response.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();

      const readLoop = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          const lines = text.split("\n").filter(Boolean);
          for (const line of lines) {
            try {
              const newState: GameState = JSON.parse(line);
              setGameState(newState);
            } catch { /* skip partial lines */ }
          }
        }
      };
      readLoop().catch(() => {});
    } catch (err: any) {
      setError(err.message || "加入游戏失败");
    }
  };

  useEffect(() => {
    joinAndStream();
    return () => {
      streamRef.current?.abort();
    };
  }, [code]);

  const handlePlayCard = (index: number) => {
    if (!gameState || gameState.currentSeat !== localSeat) return;
    const card = hand[index];
    if (!card) return;

    if (card.type === "wild" || card.type === "wild4") {
      setPendingCardIndex(index);
      setShowColorPicker(true);
      return;
    }

    doAction("play_card", index);
  };

  const handleColorSelect = async (color: CardColor) => {
    setShowColorPicker(false);
    await doAction("play_card", pendingCardIndex, color);
    setPendingCardIndex(-1);
  };

  const doAction = async (action: string, cardIndex?: number, color?: CardColor) => {
    try {
      const result = await api.playerAction(code, localSeat, action, cardIndex, color);
      if (!result.success) {
        setError(result.error || "操作失败");
        setTimeout(() => setError(""), 2000);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDraw = () => doAction("draw_card");

  const handleStart = async () => {
    try {
      const result = await api.startGame(code);
      if (!result.success) {
        setError(result.error || "开始失败");
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  // 根据 Stream 推送更新本地手牌
  useEffect(() => {
    if (gameState?.players) {
      const me = gameState.players.find(p => p.seatIndex === localSeat);
      if (me) {
        // 手牌数量由服务器同步，但实际手牌内容需要从 getGameState 拿到
        // 这里简化：仅在初始加载时获取完整手牌
      }
    }
  }, [gameState]);

  // 初次加载时获取完整状态含手牌
  useEffect(() => {
    if (localSeat >= 0) {
      // 实际应使用另一个 endpoint 获取玩家手牌，但这里简化通过直接请求
      // 在正式实现中需要后端返回玩家自己的手牌
    }
  }, [localSeat]);

  if (error) {
    return (
      <div className="game-screen">
        <p className="error">{error}</p>
        <button onClick={onLeave}>返回大厅</button>
      </div>
    );
  }

  if (!gameState) {
    return <div className="loading">加载游戏中...</div>;
  }

  const isMyTurn = gameState.currentSeat === localSeat;
  const isHost = gameState.players.find(p => p.seatIndex === localSeat)?.isHost;

  return (
    <div className="game-screen">
      <div className="game-table">
        <PlayerList players={gameState.players} currentSeat={gameState.currentSeat} localSeat={localSeat} />

        <div className="center-area">
          <DiscardPile card={gameState.topCard} />
          <div className="deck" onClick={isMyTurn ? handleDraw : undefined}>
            {gameState.phase === "playing" ? "摸牌" : ""}
          </div>
        </div>

        {gameState.phase === "playing" && (
          <PlayerHand
            cards={hand}
            onPlayCard={handlePlayCard}
            disabled={!isMyTurn}
          />
        )}

        {gameState.phase === "waiting" && isHost && (
          <button className="primary" onClick={handleStart}>
            开始游戏
          </button>
        )}

        {gameState.phase === "finished" && (
          <div style={{ textAlign: "center" }}>
            <h2>
              游戏结束！
              {gameState.winnerSeat === localSeat ? "你赢了！" : `座位 ${(gameState.winnerSeat ?? 0) + 1} 获胜`}
            </h2>
            <button onClick={onLeave}>返回大厅</button>
          </div>
        )}
      </div>

      {showColorPicker && <ColorPicker onSelect={handleColorSelect} />}
    </div>
  );
}
```

- [ ] **Step 8: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 通过

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "feat: add game UI components - GameScreen, Card, PlayerHand, ColorPicker, Leaderboard"
```

### Task 10: 完善后端与前端的数据联动（获取玩家手牌、完整游戏流程整合）

**Files:**
- Modify: `backend/src/index.ts`（GameRoomDO 添加 getPlayerHand RPC）
- Modify: `frontend/src/api.ts`（添加 getPlayerHand）
- Modify: `frontend/src/components/GameScreen.tsx`（获取手牌数据）

- [ ] **Step 1: 在 GameRoomDO 中添加 getPlayerHand 方法**

```typescript
async getPlayerHand(seatIndex: number): Promise<{ hand: Card[] }> {
  const player = this.getAllPlayers().find(p => p.seatIndex === seatIndex);
  if (!player) throw new Error("玩家不存在");
  return { hand: player.hand };
}
```

- [ ] **Step 2: 在 index.ts 的 handleGame 中支持 hand 端点**

```typescript
if (action === "hand") {
  const seatIndex = parseInt(url.searchParams.get("seat") || "-1");
  if (seatIndex < 0) return Response.json({ error: "缺少 seat 参数" }, { status: 400 });
  const result = await stub.getPlayerHand(seatIndex);
  return Response.json(result);
}
```

- [ ] **Step 3: 在 api.ts 中添加 getPlayerHand**

```typescript
getPlayerHand(code: string, seatIndex: number): Promise<{ hand: Card[] }> {
  return request(`/game/${code}/hand?seat=${seatIndex}`);
},
```

- [ ] **Step 4: 修改 GameScreen.tsx 在 joinAndStream 后加载手牌**

```typescript
const joinAndStream = async () => {
  try {
    const joinRes = await api.joinRoom(code);
    setLocalSeat(joinRes.seatIndex);

    const state = await api.getGameState(code);
    setGameState(state);

    // 获取手牌
    try {
      const handRes = await api.getPlayerHand(code, joinRes.seatIndex);
      setHand(handRes.hand);
    } catch {}

    // 建立流连接
    const controller = new AbortController();
    streamRef.current = controller;

    const response = await fetch(`/api/game/${code}/stream`, {
      signal: controller.signal,
      headers: {
        ...(user ? { Authorization: `Bearer ${localStorage.getItem("uno_token")}` } : {}),
      },
    });

    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();

    const readLoop = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        const lines = text.split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const newState: GameState = JSON.parse(line);
            setGameState(newState);
            // 刷新手牌（当前用户的手牌可能在变化）
            const handRes = await api.getPlayerHand(code, localSeat);
            setHand(handRes.hand);
          } catch { /* skip */ }
        }
      }
    };
    readLoop().catch(() => {});
  } catch (err: any) {
    setError(err.message || "加入游戏失败");
  }
};
```

- [ ] **Step 5: 类型检查**

Run: `cd frontend && npx tsc --noEmit && cd ../backend && npx tsc --noEmit`
Expected: 通过

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat: integrate player hand retrieval and full game flow"
```

### Task 11: 初始化数据库、部署配置、README

**Files:**
- Modify: `backend/wrangler.jsonc`（更新 database_id 和 kv_id）
- Create: `README.md`（根目录）

- [ ] **Step 1: 创建 D1 数据库**

Run: `cd backend && npx wrangler d1 create uno-db`
Expected: 输出 database_id，复制到 wrangler.jsonc

- [ ] **Step 2: 创建 KV 命名空间**

Run: `cd backend && npx wrangler kv:namespace create UNO_SESSIONS`
Expected: 输出 id，复制到 wrangler.jsonc 的 `kv_namespaces[0].id`

- [ ] **Step 3: 应用 D1 迁移**

Run: `cd backend && npx wrangler d1 migrations apply uno-db --local`
Expected: 001_init.sql 成功应用

- [ ] **Step 4: 测试本地运行**

Run: `cd backend && npx wrangler dev`
Expected: Worker 启动在 localhost:8787

- [ ] **Step 5: 另一个终端运行前端**

Run: `cd frontend && npx vite dev`
Expected: 前端运行在 localhost:5173

- [ ] **Step 6: 创建根 README.md**

```markdown
# UNO 在线 - 多人在线卡牌游戏

## 技术栈
- 前端: React + TypeScript + Vite
- 后端: Cloudflare Workers + D1 + KV + Durable Objects
- 部署: Cloudflare Pages（前端）+ Workers（后端）

## 本地开发

### 后端
```bash
cd backend
npm install
npx wrangler d1 migrations apply uno-db --local
npx wrangler dev
```

### 前端
```bash
cd frontend
npm install
npx vite dev
```

## 部署
```bash
cd backend && npm run deploy
```

## 项目结构
```
uno/
├── frontend/          # React 前端
├── backend/           # Cloudflare Workers 后端
├── migrations/        # D1 数据库迁移
└── docs/              # 设计文档和计划
```
```

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "docs: add README and finalize project setup"
```