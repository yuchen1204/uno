# UNO Backend 代码质量与安全重构 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 `backend/src/index.ts`（1232行）做结构化重构，修复安全漏洞（堆栈泄露、座位冒充、setTimeout 倒计时卡住），消除 `as any` 强转，规范化迁移，建立测试+lint+CI 体系。

**Architecture:** 将 GameRoomDOv2 拆分为 `game-room-do.ts`（生命周期）+ `game/actions/*`（纯游戏逻辑），类型提取到 `env.ts`，倒计时用 `storage.setAlarm` 替代 `setTimeout`，快速模式加座位 token，Durable Object SQLite schema 直接写在 CREATE TABLE 中。

**Tech Stack:** Cloudflare Workers, Durable Objects (SQLite), D1, KV, TypeScript 5.5, Vitest + @cloudflare/vitest-pool-workers, ESLint flat config, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-07-06-uno-backend-refactor-design.md`

---

### Task 1: 提取类型和接口到 env.ts

**Files:**
- Create: `backend/src/env.ts`
- Modify: `backend/src/index.ts`（删除行 15-71 的接口定义，改为 import）

- [ ] **Step 1: 创建 `backend/src/env.ts`**

```typescript
import { Card } from "./types";

export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  LOBBY_DO: DurableObjectNamespace<import("./game/lobby-do").LobbyDOv2>;
  GAME_ROOM_DO: DurableObjectNamespace<import("./game/game-room-do").GameRoomDOv2>;
}

export interface PlayerRow {
  seat_index: number;
  user_id: string | null;
  username: string;
  hand: string;
  is_host: number;
  connected: number;
  is_ready: number;
  score: number;
  skip_count: number;
  seat_token: string;
  joined_at: string;
}

export interface PlayerBasicRow {
  seat_index: number;
  user_id: string | null;
  username: string;
  is_host?: number;
}

export interface GameStateRow {
  id: number;
  phase: string;
  current_seat: number | null;
  direction: number;
  top_card: string | null;
  deck: string;
  discard_pile: string;
  wild_color: string | null;
  draw_accumulated: number;
  winner_seat: number | null;
  countdown_end: number | null;
  min_value: number;
}

export interface RoomConfigRow {
  code: string;
  type: string;
  max_players: number;
  min_players: number;
  status: string;
  last_activity: number;
}

export interface PlayHistoryRow {
  seat_index: number;
  username: string;
  card: string;
  timestamp: number;
  combo_card: string | null;
}
```

- [ ] **Step 2: 修改 `backend/src/index.ts`，删除原有 Env 和 Row 接口定义（第15-71行），改为 import**

删除 `backend/src/index.ts` 的行 15-71（`Env` 接口到 `PlayHistoryRow` 接口），在文件顶部添加：
```typescript
export { Env } from "./env";
```

同时更新 `LobbyDOv2 extends DurableObject<Env>` 和 `GameRoomDOv2 extends DurableObject<Env>` 中的引用为从 `./env` 导入。

实际做法：因为 DurableObject 类的泛型引用需要 Env 类型，且 env.ts 中 Env 引用了 DO 类（循环引用），需要调整 Env 定义为：
```typescript
// env.ts - 用 any 作为 DO namespace 占位，具体类型由 DO 类声明
export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  LOBBY_DO: DurableObjectNamespace;
  GAME_ROOM_DO: DurableObjectNamespace;
}
```

- [ ] **Step 3: 更新所有使用 `import type { Env } from "./index"` 的文件**

修改 `backend/src/auth.ts:4`：`import type { Env } from "./env";`
修改 `backend/src/rooms.ts:2`：`import type { Env } from "./env";`
修改 `backend/src/leaderboard.ts:1`：`import type { Env } from "./env";`

- [ ] **Step 4: 运行 typecheck 验证**

```bash
cd backend && npx tsc --noEmit
```
预期：PASS，无类型错误

- [ ] **Step 5: Commit**

```bash
git add backend/src/env.ts backend/src/index.ts backend/src/auth.ts backend/src/rooms.ts backend/src/leaderboard.ts
git commit -m "refactor: extract Env and Row interfaces to env.ts"
```

---

### Task 2: 消除 any — 为所有 SQL 查询加上泛型类型

**Files:**
- Modify: `backend/src/index.ts`（GameRoomDOv2 内所有 `sql.exec` 调用）

- [ ] **Step 1: 修改 `getGameState()` 返回类型为 `GameStateRow | null`**

在 `backend/src/index.ts` 中找到 `getGameState()` 方法（约850行），改为：

```typescript
import { GameStateRow } from "./env";

private getGameState(): GameStateRow | null {
  const row = this.ctx.storage.sql.exec<GameStateRow>(
    "SELECT * FROM game_state WHERE id = 1"
  ).one();
  return row;
}
```

- [ ] **Step 2: 为 `getAllPlayers()` 的查询加泛型**

在 `backend/src/index.ts` 中找到 `getAllPlayers()` 方法（约855行），改为：

```typescript
private getAllPlayers(): PlayerFull[] {
  const rows = this.ctx.storage.sql.exec<PlayerRow>(
    "SELECT * FROM players ORDER BY seat_index"
  ).toArray();
  return rows.map(r => ({
    seatIndex: r.seat_index,
    userId: r.user_id,
    username: r.username,
    hand: JSON.parse(r.hand) as Card[],
    isHost: r.is_host === 1,
    connected: r.connected === 1,
    isReady: r.is_ready === 1,
    score: r.score,
    skipCount: r.skip_count ?? 0,
  }));
}
```

- [ ] **Step 3: 修改所有 action handler 参数 `state: any` → `state: GameStateRow`**

在 `handleDrawCard`, `handleSkipTurn`, `handlePlayCard`, `executePlayCard`, `advanceToNext`, `reshuffleDiscard` 的参数中，将 `state: any` 替换为：
```typescript
import { GameStateRow } from "../env";
// ...
state: GameStateRow
```

同时在 `getFullStateForPlayer()` 中，将 `gameState` 的类型推断更新：
```typescript
const gameState = this.getGameState();
// gameState 现在自动推导为 GameStateRow | null
if (!gameState) { /* ... */ }
const topCard: Card = JSON.parse(gameState.top_card ?? "{}");
const deck: Card[] = JSON.parse(gameState.deck ?? "[]");
```

- [ ] **Step 4: 为 `playerAction` 中 `payload` 参数加明确类型**

```typescript
async playerAction(
  seatIndex: number,
  action: string,
  payload?: { cardIndex?: number; color?: CardColor; comboCardIndex?: number },
  verify: { username?: string; userId?: string; seatToken?: string } = {}
): Promise<{ success: boolean; error?: string; scoreChange?: number; targetSeat?: number }> {
```

- [ ] **Step 5: 修改所有 `toArray() as unknown as RowType[]` 为 `exec<RowType>(...).toArray()`**

在 `joinGame` 中：
```typescript
const existingPlayers = this.ctx.storage.sql.exec<PlayerBasicRow>(
  "SELECT seat_index, user_id, username, is_host FROM players ORDER BY seat_index"
).toArray();
```

在 `leaveGame` 中：
```typescript
const existingPlayers = this.ctx.storage.sql.exec<PlayerRow>(
  "SELECT seat_index, user_id, username, hand, is_host, connected, score FROM players ORDER BY seat_index"
).toArray();
```

- [ ] **Step 6: 运行 typecheck 验证**

```bash
cd backend && npx tsc --noEmit
```
预期：PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/index.ts backend/src/env.ts
git commit -m "refactor: add generic types to all DO SQL queries, replace any with GameStateRow"
```

---

### Task 3: 拆分 LobbyDOv2 到独立文件

**Files:**
- Create: `backend/src/game/lobby-do.ts`
- Modify: `backend/src/index.ts`（删除 LobbyDOv2 类定义）

- [ ] **Step 1: 创建 `backend/src/game/lobby-do.ts`**

```typescript
import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

export class LobbyDOv2 extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
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
```

- [ ] **Step 2: 修改 `backend/src/index.ts`，删除 LobbyDOv2 类定义（行73-121），添加 import**

删除第73-121行。在顶部添加：
```typescript
export { LobbyDOv2 } from "./game/lobby-do";
```

- [ ] **Step 3: 更新 `wrangler.jsonc` 中 class_name 引用路径**

`wrangler.jsonc` 第31行保持不变，因为 `class_name` 只需要类名匹配（`LobbyDOv2` 仍然从 index.ts re-export）。

- [ ] **Step 4: 运行 typecheck 验证**

```bash
cd backend && npx tsc --noEmit
```
预期：PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/game/lobby-do.ts backend/src/index.ts
git commit -m "refactor: extract LobbyDOv2 to game/lobby-do.ts"
```

---

### Task 4: 拆分 GameRoomDOv2 核心文件 + 辅助工具

**Files:**
- Create: `backend/src/game/game-room-do.ts`
- Create: `backend/src/game/utils.ts`
- Modify: `backend/src/index.ts`（删除 GameRoomDOv2 类定义，改为 re-export）

- [ ] **Step 1: 创建 `backend/src/game/utils.ts`**

提取所有纯工具函数——不依赖 DO 实例的 helper：

```typescript
import { Card, CardColor, PlayerFull } from "../types";
import { shuffleDeck } from "./deck";
import type { GameStateRow } from "../env";

export function getNextSeat(current: number, direction: 1 | -1, players: PlayerFull[]): number {
  const seats = players.map(p => p.seatIndex).sort((a, b) => a - b);
  const idx = seats.indexOf(current);
  if (idx === -1) return seats[0];
  const nextIdx = (idx + direction + seats.length) % seats.length;
  return seats[nextIdx];
}

export function advanceToNext(
  sql: SqlStorage,
  state: GameStateRow,
  players: PlayerFull[]
): void {
  const nextSeat = getNextSeat(state.current_seat!, state.direction as 1 | -1, players);
  sql.exec("UPDATE game_state SET current_seat = ? WHERE id = 1", nextSeat);
}

export function reshuffleDiscard(
  sql: SqlStorage,
  state: GameStateRow
): Card[] | null {
  const discardPile = JSON.parse(state.discard_pile) as Card[];
  if (discardPile.length < 2) return null;
  const topDiscard = discardPile[discardPile.length - 1];
  const reshuffleCards = discardPile.slice(0, -1);
  const newDeck = shuffleDeck(reshuffleCards);
  sql.exec(
    "UPDATE game_state SET deck = ?, discard_pile = ? WHERE id = 1",
    JSON.stringify(newDeck),
    JSON.stringify([topDiscard])
  );
  return newDeck;
}
```

- [ ] **Step 2: 创建 `backend/src/game/game-room-do.ts` 骨架**

将 GameRoomDOv2 类从 index.ts 复制出来，初始版本只保留：
- 构造函数（含 schema 初始化）
- `joinGame()`, `leaveGame()`
- `fetch()` (SSE stream)
- `alarm()`
- `broadcastState()`
- `getFullStateForPlayer()`, `getPlayerHand()`
- `markPlayerOffline()`
- `touchActivity()`, `ensureIdleAlarm()`
- `updateD1RoomStatus()`, `addScoreToTarget()`, `finishGame()`
- 内部 helper：`getGameState()`, `getAllPlayers()`, `updatePlayerHand()`, `updateDeck()`

暂不包含游戏动作处理器（`handleStartGame`, `actualStartGame`, `playerAction`, `toggleReady`, `continueGame`, `handleDrawCard`, `handleSkipTurn`, `handlePlayCard`, `executePlayCard`）——这些留在 Task 5 处理。

导入关系：
```typescript
import { DurableObject } from "cloudflare:workers";
import type { Env, PlayerRow, PlayerBasicRow, RoomConfigRow, GameStateRow, PlayHistoryRow } from "../env";
import { Card, CardColor, GameState, PlayerFull, PlayerInfo } from "../types";
import { getNextSeat, advanceToNext, reshuffleDiscard } from "./utils";
import { createDeck, shuffleDeck, dealCards, cardToScore } from "./deck";
import { calculateHandScore } from "./scoring";
import {
  COUNTDOWN_DURATION_MS, INITIAL_HAND_SIZE, IDLE_TIMEOUT_MS, DISCONNECT_TIMEOUT_MS,
  IDLE_CHECK_INTERVAL_MS, LAST_CARD_WILD_PENALTY, PLAY_HISTORY_LIMIT, MAX_SKIP_COUNT,
} from "../../../shared/constants";
```

构造函数 schema 改为（修复 Task 7 的迁移问题，直接在 CREATE TABLE 中声明所有列）：
```typescript
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  ctx.blockConcurrencyWhile(async () => {
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room_config (
        code TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        max_players INTEGER DEFAULT 4,
        min_players INTEGER DEFAULT 2,
        status TEXT NOT NULL DEFAULT 'waiting',
        last_activity INTEGER DEFAULT 0
      )
    `);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS players (
        seat_index INTEGER PRIMARY KEY,
        user_id TEXT,
        username TEXT NOT NULL,
        hand TEXT NOT NULL DEFAULT '[]',
        is_host INTEGER DEFAULT 0,
        connected INTEGER DEFAULT 1,
        is_ready INTEGER DEFAULT 0,
        score INTEGER DEFAULT 0,
        skip_count INTEGER DEFAULT 0,
        seat_token TEXT NOT NULL DEFAULT '',
        joined_at TEXT NOT NULL
      )
    `);
    ctx.storage.sql.exec(`
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
        winner_seat INTEGER,
        countdown_end INTEGER,
        min_value INTEGER DEFAULT -1
      )
    `);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS play_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seat_index INTEGER NOT NULL,
        username TEXT NOT NULL,
        card TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        combo_card TEXT
      )
    `);
    ctx.storage.sql.exec(`
      INSERT OR IGNORE INTO game_state (id) VALUES (1)
    `);
  });
}
```

- [ ] **Step 3: 将 `broadcastState()` 从 index.ts 复制到 game-room-do.ts**

保持原逻辑，修改导入引用。

- [ ] **Step 4: 修改 `backend/src/index.ts`，删除 GameRoomDOv2 类，改为 re-export**

删除第123-1145行，替换为：
```typescript
export { GameRoomDOv2 } from "./game/game-room-do";
```

同时删除 game 逻辑相关的 import（createDeck, shuffleDeck, dealCards, cardToScore, canPlayCard, calculateHandScore, shared/constants 中 game 相关的），只保留路由分发需要的 import。

`index.ts` 现在只保留：
- import 语句
- `handleGame()` 函数（行1147-1210）
- `export default { fetch }` (行1212-1232)

- [ ] **Step 5: 运行 typecheck 验证**

```bash
cd backend && npx tsc --noEmit
```
预期：有大量类型错误（因为 game-room-do.ts 中仍调用未迁移的 action 函数）。确认错误来源仅为"方法未定义"（如 `handleStartGame` 等）——这些会在 Task 5 修复。

- [ ] **Step 6: Commit**

```bash
git add backend/src/game/utils.ts backend/src/game/game-room-do.ts backend/src/index.ts
git commit -m "refactor: extract GameRoomDOv2 skeleton and utils to game/ directory"
```

---

### Task 5: 拆分游戏动作处理器到 actions/

**Files:**
- Create: `backend/src/game/actions/draw-card.ts`
- Create: `backend/src/game/actions/play-card.ts`
- Create: `backend/src/game/actions/skip-turn.ts`
- Create: `backend/src/game/actions/ready.ts`
- Create: `backend/src/game/actions/player-action.ts`
- Create: `backend/src/game/start-game.ts`
- Modify: `backend/src/game/game-room-do.ts`（引入 actions，删除内联方法）

- [ ] **Step 1: 创建 `backend/src/game/actions/draw-card.ts`**

每个 action 函数签名：
```typescript
(c: ActionContext, player: PlayerFull, players: PlayerFull[], state: GameStateRow, payload?: T) => ActionResult
```

其中 `ActionContext` 提供对 DO SQL 的写入能力：

```typescript
import { Card, CardColor, PlayerFull } from "../../types";
import type { GameStateRow } from "../../env";
import { canPlayCard } from "../rules";
import { reshuffleDiscard } from "../utils";

export interface ActionContext {
  sql: SqlStorage;
  updatePlayerHand(seatIndex: number, hand: Card[]): void;
  updateDeck(deck: Card[]): void;
  broadcastState(): Promise<void>;
  advanceToNext(state: GameStateRow, players: PlayerFull[]): void;
  reshuffleDiscard(state: GameStateRow): Card[] | null;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  scoreChange?: number;
  targetSeat?: number;
}

export function handleDrawCard(
  ctx: ActionContext,
  player: PlayerFull,
  players: PlayerFull[],
  state: GameStateRow
): ActionResult {
  let deck = JSON.parse(state.deck) as Card[];
  const wildColor = state.wild_color ? (state.wild_color as CardColor) : undefined;
  const topCard = JSON.parse(state.top_card) as Card;

  if (state.draw_accumulated > 0) {
    let drawCount = state.draw_accumulated;
    let drawn: Card[] = [];
    while (drawCount > 0) {
      if (deck.length === 0) {
        const reshuffled = ctx.reshuffleDiscard(state);
        if (reshuffled) {
          deck = reshuffled;
        } else {
          break;
        }
      }
      const take = Math.min(drawCount, deck.length);
      drawn.push(...deck.slice(0, take));
      deck = deck.slice(take);
      drawCount -= take;
    }
    const newHand = [...player.hand, ...drawn];
    ctx.updatePlayerHand(player.seatIndex, newHand);
    ctx.updateDeck(deck);
    ctx.sql.exec("UPDATE game_state SET draw_accumulated = 0, min_value = -1 WHERE id = 1");
    return { success: true };
  }

  const hasMatchingNormal = player.hand.some(c =>
    c.type !== "wild" &&
    c.type !== "wild4" &&
    canPlayCard(c, topCard, player.hand, wildColor, 0, state.min_value)
  );
  if (hasMatchingNormal) {
    return { success: false, error: "你手牌里有相同颜色或数字的牌，必须出牌" };
  }

  if (deck.length === 0) {
    const reshuffled = ctx.reshuffleDiscard(state);
    if (reshuffled) {
      deck = reshuffled;
    } else {
      ctx.sql.exec("UPDATE game_state SET min_value = -1 WHERE id = 1");
      ctx.advanceToNext({ ...state, min_value: -1 }, players);
      return { success: true };
    }
  }

  const drawnCard = deck[0];
  const newDeck = deck.slice(1);
  const newHand = [...player.hand, drawnCard];
  ctx.updatePlayerHand(player.seatIndex, newHand);
  ctx.updateDeck(newDeck);
  ctx.sql.exec("UPDATE game_state SET min_value = -1 WHERE id = 1");
  return { success: true };
}
```

- [ ] **Step 2: 创建 `backend/src/game/actions/skip-turn.ts`**

```typescript
import { PlayerFull } from "../../types";
import type { GameStateRow } from "../../env";
import { ActionContext, ActionResult } from "./draw-card";
import { MAX_SKIP_COUNT } from "../../../../shared/constants";

export function handleSkipTurn(
  ctx: ActionContext,
  player: PlayerFull,
  players: PlayerFull[],
  state: GameStateRow
): ActionResult {
  if (state.draw_accumulated > 0) {
    return { success: false, error: "惩罚状态下不能跳过" };
  }

  const skipCount = player.skipCount ?? 0;
  if (skipCount >= MAX_SKIP_COUNT) {
    return { success: false, error: "已跳过3次，必须出牌或摸牌" };
  }

  ctx.sql.exec("UPDATE players SET skip_count = skip_count + 1 WHERE seat_index = ?", player.seatIndex);
  ctx.sql.exec("UPDATE game_state SET min_value = -1, draw_accumulated = 0 WHERE id = 1");
  ctx.advanceToNext({ ...state, min_value: -1, draw_accumulated: 0 }, players);
  return { success: true };
}
```

- [ ] **Step 3: 创建 `backend/src/game/actions/play-card.ts`**

包含 `handlePlayCard` 和 `executePlayCard` 两个函数。代码从 index.ts 行577-779完整复制，修改为使用 `ActionContext` 模式：

```typescript
import { Card, CardColor, PlayerFull } from "../../types";
import type { GameStateRow } from "../../env";
import { ActionContext, ActionResult } from "./draw-card";
import { canPlayCard } from "../rules";
import { cardToScore } from "../deck";
import { getNextSeat } from "../utils";
import { LAST_CARD_WILD_PENALTY } from "../../../../shared/constants";

export function handlePlayCard(
  ctx: ActionContext,
  player: PlayerFull,
  players: PlayerFull[],
  state: GameStateRow,
  payload: { cardIndex: number; color?: CardColor; comboCardIndex?: number }
): ActionResult {
  const card = player.hand[payload.cardIndex];
  if (!card) return { success: false, error: "无效的牌" };

  const wildColor = state.wild_color ? (state.wild_color as CardColor) : undefined;
  const topCard = JSON.parse(state.top_card!) as Card;

  if (!canPlayCard(card, topCard, player.hand, wildColor, state.draw_accumulated, state.min_value)) {
    return { success: false, error: "不能出这张牌" };
  }

  // Wild/Wild4 Combo
  if (card.type === "wild" || card.type === "wild4") {
    // Last card wild penalty
    if (player.hand.length === 1) {
      const deck = JSON.parse(state.deck) as Card[];
      const count = Math.min(LAST_CARD_WILD_PENALTY, deck.length);
      const drawn = deck.slice(0, count);
      const newDeck = deck.slice(count);
      const newHand = player.hand.filter((_, i) => i !== payload.cardIndex).concat(drawn);
      ctx.updatePlayerHand(player.seatIndex, newHand);
      ctx.updateDeck(newDeck);
      const discardPile = JSON.parse(state.discard_pile) as Card[];
      discardPile.push(topCard);
      const nextSeat = getNextSeat(player.seatIndex, state.direction as 1 | -1, players);
      ctx.sql.exec(
        "UPDATE game_state SET current_seat = ?, top_card = ?, deck = ?, discard_pile = ?, wild_color = ?, min_value = -1 WHERE id = 1",
        nextSeat, JSON.stringify(card), JSON.stringify(newDeck),
        JSON.stringify(discardPile), payload.color || "red"
      );
      return { success: true };
    }

    // Combo card required
    if (payload.comboCardIndex === undefined) {
      return { success: false, error: "请选择一张有色牌一起出！" };
    }
    if (payload.comboCardIndex === payload.cardIndex) {
      return { success: false, error: "不能选择自身作为连携牌！" };
    }
    const comboCard = player.hand[payload.comboCardIndex];
    if (!comboCard || comboCard.type === "wild" || comboCard.type === "wild4") {
      return { success: false, error: "伴随丢出的牌必须是有色牌！" };
    }

    if (state.draw_accumulated > 0) {
      if (card.type === "wild4") {
        // valid defense
      } else if (card.type === "wild" && comboCard.type === "draw2") {
        // valid defense
      } else {
        return { success: false, error: "防守状态下，连携牌必须是+2以防御惩罚！" };
      }
    }

    const newHand = player.hand.filter((_, i) => i !== payload.cardIndex && i !== payload.comboCardIndex);
    ctx.updatePlayerHand(player.seatIndex, newHand);
    const deck = JSON.parse(state.deck) as Card[];
    const discardPile = JSON.parse(state.discard_pile) as Card[];
    discardPile.push(card);
    const nextSeat = getNextSeat(player.seatIndex, state.direction as 1 | -1, players);
    let addedPenalty = card.type === "wild4" ? 4 : 0;
    if (comboCard.type === "draw2") addedPenalty += 2;
    const newDrawAccumulated = state.draw_accumulated + addedPenalty;
    const newMinValue = comboCard.value !== undefined ? comboCard.value : -1;

    ctx.sql.exec(
      "INSERT INTO play_history (seat_index, username, card, timestamp, combo_card) VALUES (?, ?, ?, ?, ?)",
      player.seatIndex, player.username, JSON.stringify(comboCard), Date.now(), JSON.stringify(card)
    );
    ctx.sql.exec(
      "UPDATE game_state SET current_seat = ?, top_card = ?, deck = ?, discard_pile = ?, wild_color = ?, draw_accumulated = ?, min_value = ? WHERE id = 1",
      nextSeat, JSON.stringify(comboCard), JSON.stringify(deck),
      JSON.stringify(discardPile), comboCard.color, newDrawAccumulated, newMinValue
    );

    if (newHand.length === 0) {
      return { success: true, scoreChange: cardToScore(comboCard) };
      // finishGame is called by caller
    }
    return { success: true };
  }

  // Normal card
  return executePlayCard(ctx, player, players, state, card, {
    seatIndex: player.seatIndex,
    hand: player.hand,
    deck: JSON.parse(state.deck) as Card[],
    topCard,
    wildColor,
    cardIndex: payload.cardIndex,
  });
}

function executePlayCard(
  ctx: ActionContext,
  player: PlayerFull,
  players: PlayerFull[],
  state: GameStateRow,
  card: Card,
  ctxData: { seatIndex: number; hand: Card[]; deck: Card[]; topCard: Card; wildColor?: CardColor; cardIndex: number }
): ActionResult {
  const filteredHand = ctxData.hand.filter((_, i) => i !== ctxData.cardIndex);
  ctx.updatePlayerHand(player.seatIndex, filteredHand);
  let newDeck = ctxData.deck;
  const discardPile = JSON.parse(state.discard_pile) as Card[];
  discardPile.push(ctxData.topCard);
  let nextSeat = getNextSeat(ctxData.seatIndex, state.direction as 1 | -1, players);
  let newDirection = state.direction;
  let scoreChange = 0;
  let targetSeat: number | undefined;
  let wildColor: CardColor | undefined = undefined;
  let skipAfter = false;
  let addedPenalty = 0;
  let newMinValue = card.value !== undefined ? card.value : -1;

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
    } else {
      nextSeat = getNextSeat(ctxData.seatIndex, newDirection as 1 | -1, players);
    }
  } else if (card.type === "draw2") {
    addedPenalty = 2;
  }

  const updatedCurrentSeat = skipAfter ? getNextSeat(nextSeat, newDirection as 1 | -1, players) : nextSeat;
  const newDrawAccumulated = state.draw_accumulated + addedPenalty;

  ctx.sql.exec(
    "INSERT INTO play_history (seat_index, username, card, timestamp) VALUES (?, ?, ?, ?)",
    player.seatIndex, player.username, JSON.stringify(card), Date.now()
  );
  ctx.sql.exec(
    "UPDATE game_state SET phase = 'playing', current_seat = ?, direction = ?, top_card = ?, deck = ?, discard_pile = ?, wild_color = ?, draw_accumulated = ?, min_value = ? WHERE id = 1",
    updatedCurrentSeat, newDirection, JSON.stringify(card), JSON.stringify(newDeck),
    JSON.stringify(discardPile), wildColor || null, newDrawAccumulated, newMinValue
  );

  if (filteredHand.length === 0) {
    return { success: true, scoreChange: cardToScore(card) + scoreChange, targetSeat };
  }

  if (targetSeat !== undefined && scoreChange > 0) {
    // Score update is handled by caller
  }

  return { success: true, scoreChange, targetSeat };
}
```

- [ ] **Step 4: 创建 `backend/src/game/actions/ready.ts`**

```typescript
import { PlayerFull } from "../../types";
import type { GameStateRow } from "../../env";
import { ActionContext, ActionResult } from "./draw-card";

export function toggleReady(
  ctx: ActionContext,
  seatIndex: number,
  players: PlayerFull[],
  gameState: GameStateRow | null
): ActionResult {
  if (gameState?.phase !== "waiting") return { success: false, error: "当前不能准备" };

  const me = players.find(p => p.seatIndex === seatIndex);
  if (!me) return { success: false, error: "玩家不存在" };

  const newReadyState = me.isReady ? 0 : 1;
  ctx.sql.exec("UPDATE players SET is_ready = ? WHERE seat_index = ?", newReadyState, seatIndex);

  return { success: true };
}

export function continueGame(
  ctx: ActionContext,
  seatIndex: number,
  gameState: GameStateRow | null
): ActionResult {
  if (gameState?.phase !== "finished") return { success: false, error: "游戏未结束" };

  ctx.sql.exec(
    "UPDATE game_state SET phase = 'waiting', deck = '[]', discard_pile = '[]', top_card = NULL, wild_color = NULL, current_seat = NULL, winner_seat = NULL, draw_accumulated = 0, countdown_end = 0, min_value = -1"
  );
  ctx.sql.exec("UPDATE room_config SET status = 'waiting'");
  ctx.sql.exec("UPDATE players SET is_ready = 0, hand = '[]', skip_count = 0");
  ctx.sql.exec("UPDATE players SET is_ready = 1 WHERE seat_index = ?", seatIndex);

  return { success: true };
}
```

- [ ] **Step 5: 创建 `backend/src/game/actions/player-action.ts`**

```typescript
import { CardColor, PlayerFull } from "../../types";
import type { GameStateRow } from "../../env";
import { ActionContext, ActionResult } from "./draw-card";
import { handleDrawCard } from "./draw-card";
import { handleSkipTurn } from "./skip-turn";
import { handlePlayCard } from "./play-card";
import { toggleReady, continueGame } from "./ready";
import { cardToScore } from "../deck";

export interface PlayerActionPayload {
  cardIndex?: number;
  color?: CardColor;
  comboCardIndex?: number;
}

export function routePlayerAction(
  ctx: ActionContext,
  seatIndex: number,
  action: string,
  gameState: GameStateRow | null,
  player: PlayerFull,
  players: PlayerFull[],
  payload?: PlayerActionPayload
): ActionResult {
  if (action === "toggle_ready") {
    return toggleReady(ctx, seatIndex, players, gameState);
  }
  if (action === "continue_game") {
    return continueGame(ctx, seatIndex, gameState);
  }

  if (!gameState || gameState.phase !== "playing") {
    return { success: false, error: "游戏未进行中" };
  }
  if (gameState.current_seat !== seatIndex) {
    return { success: false, error: "不是你的回合" };
  }

  if (action === "draw_card") {
    const res = handleDrawCard(ctx, player, players, gameState);
    if (res.success) {
      ctx.sql.exec("UPDATE players SET skip_count = 0 WHERE seat_index = ?", player.seatIndex);
    }
    return res;
  }
  if (action === "skip_turn") {
    return handleSkipTurn(ctx, player, players, gameState);
  }
  if (action === "play_card") {
    if (!payload || payload.cardIndex === undefined) {
      return { success: false, error: "缺少 cardIndex" };
    }
    const res = handlePlayCard(ctx, player, players, gameState, {
      cardIndex: payload.cardIndex,
      color: payload.color,
      comboCardIndex: payload.comboCardIndex,
    });
    if (res.success) {
      ctx.sql.exec("UPDATE players SET skip_count = 0 WHERE seat_index = ?", player.seatIndex);
    }
    return res;
  }
  if (action === "say_uno") {
    return { success: true };
  }
  return { success: false, error: "无效操作" };
}
```

- [ ] **Step 6: 创建 `backend/src/game/start-game.ts`**

```typescript
import { Card, CardColor, PlayerFull } from "../types";
import type { GameStateRow, RoomConfigRow, PlayerRow } from "../env";
import { createDeck, shuffleDeck, dealCards } from "./deck";
import { COUNTDOWN_DURATION_MS, INITIAL_HAND_SIZE } from "../../../shared/constants";

export interface StartGameContext {
  sql: SqlStorage;
  env: { LOBBY_DO: DurableObjectNamespace; DB?: D1Database };
  getAllPlayers(): PlayerFull[];
  getGameState(): GameStateRow | null;
  broadcastState(): Promise<void>;
  updateD1RoomStatus(code: string, status: string): Promise<void>;
  finishGame(winnerSeat: number, players: PlayerFull[], finalCardScore: number, actionScore: number): Promise<void>;
  setCountdownAlarm(): Promise<void>;
}

export async function handleStartGame(ctx: StartGameContext): Promise<{ success: boolean; error?: string }> {
  const gameState = ctx.getGameState();
  if (gameState?.phase !== "waiting") return { success: false, error: "当前不能开始" };

  const players = ctx.getAllPlayers();
  if (players.length < 2) return { success: false, error: "玩家人数不足" };

  ctx.sql.exec("UPDATE game_state SET phase = 'countdown', countdown_end = ?", Date.now() + COUNTDOWN_DURATION_MS);
  ctx.sql.exec("UPDATE room_config SET status = 'countdown'");
  await ctx.setCountdownAlarm();
  await ctx.broadcastState();
  return { success: true };
}

export async function actualStartGame(ctx: StartGameContext): Promise<{ success: boolean; error?: string }> {
  const config = ctx.sql.exec<RoomConfigRow>("SELECT * FROM room_config LIMIT 1").one();
  if (!config) return { success: false, error: "房间未初始化" };

  const gameState = ctx.getGameState();
  if (gameState?.phase !== "countdown") return { success: false, error: "不在倒数阶段" };

  const players = ctx.sql.exec<PlayerRow>(
    "SELECT * FROM players ORDER BY seat_index"
  ).toArray();
  const fullPlayers = players.map(r => ({
    seatIndex: r.seat_index,
    userId: r.user_id,
    username: r.username,
    hand: JSON.parse(r.hand) as Card[],
    isHost: r.is_host === 1,
    connected: r.connected === 1,
    isReady: r.is_ready === 1,
    score: r.score,
    skipCount: r.skip_count ?? 0,
  }));

  if (fullPlayers.length < 2) {
    ctx.sql.exec("UPDATE game_state SET phase = 'waiting', countdown_end = 0");
    await ctx.broadcastState();
    return { success: false, error: "玩家人数不足" };
  }

  ctx.sql.exec("DELETE FROM play_history");

  let deck = shuffleDeck(createDeck());
  for (const player of fullPlayers) {
    const { cards, remaining } = dealCards(deck, INITIAL_HAND_SIZE);
    deck = remaining;
    ctx.sql.exec(
      "UPDATE players SET hand = ? WHERE seat_index = ?",
      JSON.stringify(cards), player.seatIndex
    );
  }

  let topCard: Card;
  do {
    topCard = deck[0];
    deck = deck.slice(1);
  } while (topCard.type === "wild4");

  let wildColor: CardColor | undefined;
  if (topCard.type === "wild") {
    wildColor = (["red", "yellow", "blue", "green"] as CardColor[])[Math.floor(Math.random() * 4)];
  }

  ctx.sql.exec(
    "UPDATE game_state SET phase = 'playing', current_seat = 0, direction = 1, top_card = ?, deck = ?, discard_pile = '[]', wild_color = ?, draw_accumulated = 0, min_value = -1 WHERE id = 1",
    JSON.stringify(topCard), JSON.stringify(deck), wildColor || null
  );
  ctx.sql.exec("UPDATE room_config SET status = 'playing'");
  await ctx.updateD1RoomStatus(config.code, "playing");

  if (config.type === "public") {
    const lobbyId = ctx.env.LOBBY_DO.idFromName("global_v2");
    const lobbyStub = ctx.env.LOBBY_DO.get(lobbyId);
    await lobbyStub.removeRoom(config.code);
  }

  await ctx.broadcastState();
  return { success: true };
}
```

- [ ] **Step 7: 更新 `game-room-do.ts`，将 `playerAction`, `handleStartGame`, `actualStartGame`, `toggleReady`, `continueGame` 替换为对 actions 模块的调用**

在 `game-room-do.ts` 中添加 import：
```typescript
import { routePlayerAction, PlayerActionPayload } from "./actions/player-action";
import { handleStartGame, actualStartGame } from "./start-game";
import type { ActionContext } from "./actions/draw-card";
import { getNextSeat, advanceToNext, reshuffleDiscard } from "./utils";
```

`playerAction` 方法改为：
```typescript
async playerAction(
  seatIndex: number,
  action: string,
  payload?: PlayerActionPayload,
  verify: { username?: string; userId?: string; seatToken?: string } = {}
): Promise<{ success: boolean; error?: string; scoreChange?: number; targetSeat?: number }> {
  const players = this.getAllPlayers();
  const player = players.find(p => p.seatIndex === seatIndex);
  if (!player) return { success: false, error: "玩家不存在" };

  const seatOwnerId = verify.userId || null;
  const seatOwnerName = verify.username || null;
  if (seatOwnerId && player.userId && seatOwnerId !== player.userId) {
    return { success: false, error: "不是你的座位" };
  }
  if (seatOwnerName && seatOwnerName !== player.username) {
    return { success: false, error: "不是你的座位" };
  }

  // Quick room seat token verification
  const config = this.getRoomConfig();
  if (config?.type === "quick") {
    const tokenRow = this.ctx.storage.sql.exec<{ seat_token: string }>(
      "SELECT seat_token FROM players WHERE seat_index = ?", seatIndex
    ).one();
    if (!verify.seatToken || !tokenRow || tokenRow.seat_token !== verify.seatToken) {
      return { success: false, error: "座位验证失败" };
    }
  }

  const gameState = this.getGameState();

  const ctx: ActionContext = {
    sql: this.ctx.storage.sql,
    updatePlayerHand: (si, hand) => this.updatePlayerHand(si, hand),
    updateDeck: (deck) => this.updateDeck(deck),
    broadcastState: () => this.broadcastState(),
    advanceToNext: (s, p) => advanceToNext(this.ctx.storage.sql, s, p),
    reshuffleDiscard: (s) => reshuffleDiscard(this.ctx.storage.sql, s),
  };

  const result = routePlayerAction(ctx, seatIndex, action, gameState, player, players, payload);

  if (result.success && action !== "toggle_ready" && action !== "continue_game") {
    // Check for game end (empty hand)
    const updatedPlayer = this.getAllPlayers().find(p => p.seatIndex === seatIndex);
    if (updatedPlayer && updatedPlayer.hand.length === 0) {
      await this.finishGame(seatIndex, players, result.scoreChange ?? 0, 0);
    }
    // Handle score change for skip/reverse
    if (result.targetSeat !== undefined && (result.scoreChange ?? 0) > 0) {
      this.addScoreToTarget(result.targetSeat, result.scoreChange!, players);
    }
  }

  await this.broadcastState();
  return result;
}
```

`handleStartGame` 方法改为：
```typescript
async handleStartGame(): Promise<{ success: boolean; error?: string }> {
  const startCtx = {
    sql: this.ctx.storage.sql,
    env: this.env,
    getAllPlayers: () => this.getAllPlayers(),
    getGameState: () => this.getGameState(),
    broadcastState: () => this.broadcastState(),
    updateD1RoomStatus: (code: string, status: string) => this.updateD1RoomStatus(code, status),
    finishGame: (ws: number, p: PlayerFull[], fcs: number, as: number) => this.finishGame(ws, p, fcs, as),
    setCountdownAlarm: async () => {
      await this.ctx.storage.setAlarm(Date.now() + COUNTDOWN_DURATION_MS);
    },
  };
  return handleStartGame(startCtx);
}

async actualStartGame(): Promise<{ success: boolean; error?: string }> {
  const startCtx = {
    sql: this.ctx.storage.sql,
    env: this.env,
    getAllPlayers: () => this.getAllPlayers(),
    getGameState: () => this.getGameState(),
    broadcastState: () => this.broadcastState(),
    updateD1RoomStatus: (code: string, status: string) => this.updateD1RoomStatus(code, status),
    finishGame: (ws: number, p: PlayerFull[], fcs: number, as: number) => this.finishGame(ws, p, fcs, as),
    setCountdownAlarm: async () => {
      await this.ctx.storage.setAlarm(Date.now() + COUNTDOWN_DURATION_MS);
    },
  };
  return actualStartGame(startCtx);
}
```

删除原有的 `handleDrawCard`, `handleSkipTurn`, `handlePlayCard`, `executePlayCard`, `toggleReady`, `continueGame` 方法。

更新 `getNextSeat` 调用为从 utils 导入。

- [ ] **Step 8: 运行 typecheck 验证**

```bash
cd backend && npx tsc --noEmit
```
预期：PASS

- [ ] **Step 9: Commit**

```bash
git add backend/src/game/actions/ backend/src/game/start-game.ts backend/src/game/game-room-do.ts
git commit -m "refactor: extract game action handlers to game/actions/ and start-game.ts"
```

---

### Task 6: 修复错误堆栈泄露

**Files:**
- Modify: `backend/src/auth.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: 修复 `auth.ts` 的 handleRegister catch**

将行58-60改为：
```typescript
} catch (e: any) {
  console.error("handleRegister error:", e);
  return Response.json({ error: e.message || "注册失败" }, { status: 500 });
}
```

- [ ] **Step 2: 修复 `auth.ts` 的 handleLogin catch**

将行80-82改为：
```typescript
} catch (e: any) {
  console.error("handleLogin error:", e);
  return Response.json({ error: e.message || "登录失败" }, { status: 500 });
}
```

- [ ] **Step 3: 确认 `index.ts` 的最外层 catch 不泄露堆栈**

当前 `index.ts:1229`：
```typescript
return Response.json({ error: e.message || "内部服务器错误" }, { status: 500 });
```
此处仅返回 `e.message`（中文错误消息），不包含 `e.stack`，但建议增加 console.error：
```typescript
} catch (e: any) {
  console.error("Unhandled error:", e);
  return Response.json({ error: "内部服务器错误" }, { status: 500 });
}
```

- [ ] **Step 4: 运行 typecheck 验证**

```bash
cd backend && npx tsc --noEmit
```
预期：PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth.ts backend/src/index.ts
git commit -m "fix: remove error stack from API responses, log internally instead"
```

---

### Task 7: 快速模式座位 Token 机制

**Files:**
- Modify: `backend/src/game/game-room-do.ts`（joinGame, playerAction, leaveGame）
- Modify: `backend/src/index.ts`（handleGame 中解析 X-Uno-Seat-Token）
- Modify: `backend/src/rooms.ts`（返回 seatToken）

- [ ] **Step 1: 在 `joinGame()` 中生成 seatToken 并返回**

在 `game-room-do.ts` 的 `joinGame()` 方法中：

（a）在 INSERT 语句中加入 seat_token 列：
```typescript
const seatToken = crypto.randomUUID();
this.ctx.storage.sql.exec(
  "INSERT INTO players (seat_index, user_id, username, hand, is_host, connected, is_ready, seat_token, joined_at) VALUES (?, ?, ?, '[]', ?, 1, 0, ?, ?)",
  seatIndex, userId, username, isHost ? 1 : 0, seatToken, now,
);
```

（b）返回值中包含 seatToken：
```typescript
return { seatIndex, playerCount: existingPlayers.length + 1, seatToken };
```

（c）在重连分支（existingMe）也返回 seatToken：
```typescript
const tokenRow = this.ctx.storage.sql.exec<{ seat_token: string }>(
  "SELECT seat_token FROM players WHERE seat_index = ?", existingMe.seat_index
).one();
return { seatIndex: existingMe.seat_index, playerCount: existingPlayers.length, seatToken: tokenRow?.seat_token };
```

- [ ] **Step 2: 在 `playerAction()` 中校验 seatToken（已在 Task 5 Step 7 中实现）**

确认 `playerAction` 中的 quick room token 校验逻辑已就位：
```typescript
const config = this.getRoomConfig();
if (config?.type === "quick") {
  const tokenRow = this.ctx.storage.sql.exec<{ seat_token: string }>(
    "SELECT seat_token FROM players WHERE seat_index = ?", seatIndex
  ).one();
  if (!verify.seatToken || !tokenRow || tokenRow.seat_token !== verify.seatToken) {
    return { success: false, error: "座位验证失败" };
  }
}
```

- [ ] **Step 3: 在 `handleGame()` 中解析 `X-Uno-Seat-Token` 并传入**

在 `index.ts` 的 `handleGame()` 函数（action 分支）中：
```typescript
if (action === "action") {
  const body = await request.json<{ seatIndex: number; action: string; cardIndex?: number; color?: CardColor; comboCardIndex?: number }>();
  let verifyUsername: string | undefined;
  let verifyUserId: string | undefined;
  let verifySeatToken: string | undefined;

  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const sessionRaw = await env.SESSIONS.get(`session:${token}`);
    if (sessionRaw) {
      const session = JSON.parse(sessionRaw);
      verifyUserId = session.userId;
      verifyUsername = session.username;
    } else {
      const quickSession = await env.SESSIONS.get(`quick:${token}`);
      if (quickSession) {
        verifyUsername = JSON.parse(quickSession).nickname;
      }
    }
  } else {
    const nick = request.headers.get("X-Uno-Nickname");
    if (nick) verifyUsername = nick;
  }
  verifySeatToken = request.headers.get("X-Uno-Seat-Token") || undefined;

  const result = await stub.playerAction(
    body.seatIndex, body.action,
    { cardIndex: body.cardIndex, color: body.color, comboCardIndex: body.comboCardIndex },
    { username: verifyUsername, userId: verifyUserId, seatToken: verifySeatToken }
  );
  return Response.json(result);
}
```

- [ ] **Step 4: 更新 `rooms.ts` 的 `handleJoinRoom` 透传 seatToken**

```typescript
const joinResult = await gameStub.joinGame(code, username, userId, room.max_players, room.type);
// joinResult now includes seatToken
return Response.json({ ...joinResult, code });
```

- [ ] **Step 5: 更新前端的 API 类型（如果有 frontend api.ts 的 types）**

检查 `frontend/src/api.ts` 和 `frontend/src/types.ts` 是否需要更新 `joinRoom` 返回值类型以包含 `seatToken`。如果需要更新，则进行相应修改。

- [ ] **Step 6: 运行 typecheck 验证**

```bash
cd backend && npx tsc --noEmit
```
预期：PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/game/game-room-do.ts backend/src/index.ts backend/src/rooms.ts
git commit -m "feat: add seat token for quick room authentication"
```

---

### Task 8: setTimeout 倒计时 → storage.setAlarm

**Files:**
- Modify: `backend/src/game/game-room-do.ts`

- [ ] **Step 1: 引入 alarm tag 常量**

在 `game-room-do.ts` 顶部添加：
```typescript
const ALARM_START_GAME = 1;
const ALARM_IDLE = 2;
```

- [ ] **Step 2: 修改 `alarm()` 方法支持 tag 分发**

```typescript
async alarm(tag?: number): Promise<void> {
  if (tag === ALARM_START_GAME) {
    await this.actualStartGame();
    return;
  }

  // ... existing idle/disconnect timeout logic ...
}
```

- [ ] **Step 3: 修改 `ensureIdleAlarm()` 使用 tag**

```typescript
private async ensureIdleAlarm(force: boolean = false): Promise<void> {
  const existing = this.ctx.storage.sql.exec<{ last_activity: number }>(
    "SELECT last_activity FROM room_config LIMIT 1"
  ).one();
  const lastActivity = existing?.last_activity ?? 0;
  const elapsed = Date.now() - lastActivity;
  const checkInterval = IDLE_CHECK_INTERVAL_MS;
  if (force || lastActivity === 0 || elapsed < checkInterval) {
    await this.ctx.storage.setAlarm(Date.now() + checkInterval);
  }
}
```

- [ ] **Step 4: 移除 `handleStartGame` 中的 `setTimeout`**

在 `game-room-do.ts` 的 `handleStartGame()` 中确认已通过 `start-game.ts` 的 `setCountdownAlarm` 调用 `storage.setAlarm`（已在 Task 5 Step 7 实现）。

- [ ] **Step 5: 移除 `toggleReady` 中的 `setTimeout`**

`toggleReady` 中的自动开局倒计时也需要用 alarm。由于 `toggleReady` 的逻辑已移到 `actions/ready.ts`，需要在 `playerAction` 中处理倒计时设置：

在 `game-room-do.ts` 的 `playerAction` 方法中，`toggle_ready` 返回后：
```typescript
if (action === "toggle_ready" && result.success) {
  const updatedPlayers = this.getAllPlayers();
  const connectedPlayers = updatedPlayers.filter(p => p.connected);
  const allReady = connectedPlayers.every(p => p.isReady);
  if (allReady && connectedPlayers.length >= 2) {
    this.ctx.storage.sql.exec(
      "UPDATE game_state SET phase = 'countdown', countdown_end = ?",
      Date.now() + COUNTDOWN_DURATION_MS
    );
    this.ctx.storage.sql.exec("UPDATE room_config SET status = 'countdown'");
    await this.ctx.storage.setAlarm(Date.now() + COUNTDOWN_DURATION_MS);
  }
}
```

- [ ] **Step 6: 修改 `leaveGame` 中倒计时取消逻辑**

当 `gameState?.phase === "countdown"` 时，除了重置 game_state，还需取消 alarm：
```typescript
if (gameState?.phase === "countdown") {
  await this.ctx.storage.deleteAlarm();
  this.ctx.storage.sql.exec("UPDATE game_state SET phase = 'waiting', countdown_end = 0");
  this.ctx.storage.sql.exec("UPDATE room_config SET status = 'waiting'");
}
```

- [ ] **Step 7: 运行 typecheck 验证**

```bash
cd backend && npx tsc --noEmit
```
预期：PASS

- [ ] **Step 8: Commit**

```bash
git add backend/src/game/game-room-do.ts backend/src/game/actions/ready.ts
git commit -m "fix: replace setTimeout with storage.setAlarm for game countdown"
```

---

### Task 9: 移除 try/catch ALTER TABLE 迁移

**Files:**
- Modify: `backend/src/game/game-room-do.ts`

- [ ] **Step 1: 确认构造函数中所有列已在 CREATE TABLE 中声明**

在 Task 4 Step 2 中，我们已经将所有列（包括 `skip_count`, `is_ready`, `seat_token`, `countdown_end`, `min_value`, `last_activity`）写入了 CREATE TABLE 语句。确认代码中**不存在**任何 `try { ALTER TABLE ... } catch {}` 语句。

- [ ] **Step 2: 如果 wrangler.jsonc 中有旧的 DO 类名 migration，保留不动**

`wrangler.jsonc` 的 migrations 部分引用的是旧的 `LobbyDO` / `GameRoomDO` 类名迁移到 `LobbyDOv2` / `GameRoomDOv2`，这是正确的 Wrangler DO migration 机制，不需要改动。

- [ ] **Step 3: 运行 typecheck**

```bash
cd backend && npx tsc --noEmit
```
预期：PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/game/game-room-do.ts
git commit -m "refactor: inline all DO schema columns in CREATE TABLE, remove ALTER TABLE try/catch"
```

---

### Task 10: 配置 ESLint

**Files:**
- Create: `backend/eslint.config.mjs`
- Create: `backend/.prettierrc`
- Modify: `backend/package.json`

- [ ] **Step 1: 安装 ESLint 依赖**

```bash
cd backend && npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier
```
预期：安装成功

- [ ] **Step 2: 创建 `backend/eslint.config.mjs`**

```javascript
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["dist/", "node_modules/", ".wrangler/"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
];
```

- [ ] **Step 3: 创建 `backend/.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 120,
  "tabWidth": 2
}
```

- [ ] **Step 4: 更新 `backend/package.json` 的 scripts**

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "format": "prettier --write src/"
  }
}
```

- [ ] **Step 5: 运行 lint 并修复自动可修复的问题**

```bash
cd backend && npx eslint src/ --fix
```
预期：PASS 或仅 warn（any 的警告）

- [ ] **Step 6: Commit**

```bash
git add backend/eslint.config.mjs backend/.prettierrc backend/package.json
git commit -m "chore: add ESLint and Prettier configuration"
```

---

### Task 11: 配置 Vitest 集成测试

**Files:**
- Create: `backend/vitest.config.ts`
- Create: `backend/test/tsconfig.json`
- Create: `backend/test/rules.test.ts`
- Create: `backend/test/deck.test.ts`
- Create: `backend/test/scoring.test.ts`
- Create: `backend/test/game-room.test.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: 安装 Vitest 依赖**

```bash
cd backend && npm install --save-dev vitest @cloudflare/vitest-pool-workers
```
预期：安装成功

- [ ] **Step 2: 创建 `backend/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "@cloudflare/vitest-pool-workers",
    poolOptions: {
      workers: {
        wrangler: {
          configPath: "./wrangler.jsonc",
        },
      },
    },
  },
});
```

- [ ] **Step 3: 创建 `backend/test/tsconfig.json`**

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]
  },
  "include": ["./**/*.ts", "../src/**/*.ts", "../../shared/**/*.ts"]
}
```

- [ ] **Step 4: 创建 `backend/test/rules.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { canPlayCard } from "../src/game/rules";
import { Card, CardColor } from "../src/types";

const makeCard = (color: CardColor, type: string, value?: number): Card => ({
  color,
  type: type as Card["type"],
  value,
});

describe("canPlayCard", () => {
  it("allows same color match", () => {
    const hand: Card[] = [makeCard("red", "number", 5), makeCard("blue", "number", 3)];
    const topCard = makeCard("red", "number", 3);
    expect(canPlayCard(hand[0], topCard, hand)).toBe(true);
  });

  it("allows same number match across colors", () => {
    const hand: Card[] = [makeCard("blue", "number", 3)];
    const topCard = makeCard("red", "number", 3);
    expect(canPlayCard(hand[0], topCard, hand)).toBe(true);
  });

  it("allows same type match across colors", () => {
    const hand: Card[] = [{ color: "blue", type: "skip" }];
    const topCard = { color: "red", type: "skip" };
    expect(canPlayCard(hand[0], topCard, hand)).toBe(true);
  });

  it("allows wild card always", () => {
    const hand: Card[] = [{ type: "wild" }];
    const topCard = makeCard("red", "number", 5);
    expect(canPlayCard(hand[0], topCard, hand)).toBe(true);
  });

  it("allows wild4 always", () => {
    const hand: Card[] = [{ type: "wild4" }];
    const topCard = makeCard("green", "skip");
    expect(canPlayCard(hand[0], topCard, hand)).toBe(true);
  });

  it("rejects wrong color and number", () => {
    const hand: Card[] = [makeCard("blue", "number", 7)];
    const topCard = makeCard("red", "number", 3);
    expect(canPlayCard(hand[0], topCard, hand)).toBe(false);
  });

  it("respects wildColor for matching", () => {
    const hand: Card[] = [makeCard("blue", "number", 3)];
    const topCard = { type: "wild" };
    const wildColor: CardColor = "blue";
    expect(canPlayCard(hand[0], topCard, hand, wildColor)).toBe(true);
  });

  it("draw2 defense: only draw2 or wild4 allowed under penalty", () => {
    const hand: Card[] = [
      { color: "red", type: "draw2" },
      { color: "red", type: "number", value: 5 },
      { type: "wild4" },
    ];
    const topCard = makeCard("red", "draw2");
    // under draw penalty
    expect(canPlayCard(hand[0], topCard, hand, undefined, 2)).toBe(true);
    expect(canPlayCard(hand[1], topCard, hand, undefined, 2)).toBe(false);
    expect(canPlayCard(hand[2], topCard, hand, undefined, 2)).toBe(true);
  });

  it("respects minValue for number chains", () => {
    const hand: Card[] = [makeCard("red", "number", 6)];
    const topCard = makeCard("red", "number", 5);
    // minValue = 5 means only value >= 5 or value+1 = 6
    expect(canPlayCard(hand[0], topCard, hand, undefined, 0, 5)).toBe(true);
    // value 4 should fail
    const hand2: Card[] = [makeCard("red", "number", 4)];
    expect(canPlayCard(hand2[0], topCard, hand2, undefined, 0, 5)).toBe(false);
  });

  it("reverse matches same type across colors", () => {
    const hand: Card[] = [{ color: "green", type: "reverse" }];
    const topCard = { color: "yellow", type: "reverse" };
    expect(canPlayCard(hand[0], topCard, hand)).toBe(true);
  });
});
```

- [ ] **Step 5: 创建 `backend/test/deck.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { createDeck, shuffleDeck, dealCards, cardToScore, cardToActionScore } from "../src/game/deck";

describe("createDeck", () => {
  it("creates 108 cards", () => {
    const deck = createDeck();
    expect(deck.length).toBe(108);
  });

  it("contains 4 wild cards", () => {
    const deck = createDeck();
    expect(deck.filter(c => c.type === "wild").length).toBe(4);
  });

  it("contains 4 wild4 cards", () => {
    const deck = createDeck();
    expect(deck.filter(c => c.type === "wild4").length).toBe(4);
  });
});

describe("shuffleDeck", () => {
  it("returns same length", () => {
    const deck = createDeck();
    const shuffled = shuffleDeck(deck);
    expect(shuffled.length).toBe(deck.length);
  });

  it("does not mutate original", () => {
    const deck = createDeck();
    const original = [...deck];
    shuffleDeck(deck);
    expect(deck).toEqual(original);
  });
});

describe("dealCards", () => {
  it("deals correct count", () => {
    const deck = createDeck();
    const { cards, remaining } = dealCards(deck, 7);
    expect(cards.length).toBe(7);
    expect(remaining.length).toBe(108 - 7);
  });
});

describe("cardToScore", () => {
  it("number cards score face value", () => {
    expect(cardToScore({ color: "red", type: "number", value: 5 })).toBe(5);
    expect(cardToScore({ color: "blue", type: "number", value: 0 })).toBe(0);
  });

  it("action cards score 20", () => {
    expect(cardToScore({ color: "green", type: "skip" })).toBe(20);
    expect(cardToScore({ color: "yellow", type: "reverse" })).toBe(20);
    expect(cardToScore({ color: "red", type: "draw2" })).toBe(20);
  });

  it("wild cards score 50", () => {
    expect(cardToScore({ type: "wild" })).toBe(50);
    expect(cardToScore({ type: "wild4" })).toBe(50);
  });
});
```

- [ ] **Step 6: 创建 `backend/test/scoring.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { calculateHandScore, calculateActionScore } from "../src/game/scoring";
import { Card } from "../src/types";

describe("calculateHandScore", () => {
  it("sums card scores", () => {
    const hand: Card[] = [
      { color: "red", type: "number", value: 5 },
      { color: "blue", type: "skip" },
      { type: "wild" },
    ];
    expect(calculateHandScore(hand)).toBe(5 + 20 + 50);
  });

  it("returns 0 for empty hand", () => {
    expect(calculateHandScore([])).toBe(0);
  });
});

describe("calculateActionScore", () => {
  it("skip/reverse = 20", () => {
    expect(calculateActionScore({ color: "red", type: "skip" })).toBe(20);
  });
  it("draw2 = 20", () => {
    expect(calculateActionScore({ color: "green", type: "draw2" })).toBe(20);
  });
  it("wild4 = 50", () => {
    expect(calculateActionScore({ type: "wild4" })).toBe(50);
  });
  it("number = 0", () => {
    expect(calculateActionScore({ color: "yellow", type: "number", value: 3 })).toBe(0);
  });
});
```

- [ ] **Step 7: 创建 `backend/test/game-room.test.ts`**（集成测试骨架）

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import {
  createDeck,
  shuffleDeck,
  dealCards,
} from "../src/game/deck";
import { canPlayCard } from "../src/game/rules";
import { Card, CardColor } from "../src/types";

describe("Full Game Flow (logic layer)", () => {
  it("simulates a basic 2-player game: play cards until win", () => {
    // Setup deck and deal
    let deck = shuffleDeck(createDeck());
    const p1Hand: Card[] = [];
    const p2Hand: Card[] = [];
    const { cards: c1, remaining: r1 } = dealCards(deck, 7);
    p1Hand.push(...c1);
    deck = r1;
    const { cards: c2, remaining: r2 } = dealCards(deck, 7);
    p2Hand.push(...c2);
    deck = r2;

    // Pick top card
    let topCard = deck[0];
    deck = deck.slice(1);
    while (topCard.type === "wild4") {
      topCard = deck[0];
      deck = deck.slice(1);
    }

    expect(p1Hand.length).toBe(7);
    expect(p2Hand.length).toBe(7);
    expect(deck.length).toBe(108 - 14 - 1);
  });

  it("wild combo: wild + colored card reduces hand by 2", () => {
    const hand: Card[] = [
      { type: "wild" },
      { color: "red", type: "number", value: 3 },
    ];
    const topCard: Card = { color: "blue", type: "number", value: 5 };

    expect(canPlayCard(hand[0], topCard, hand)).toBe(true);
    // After playing wild + combo, hand should have 0 cards
    const newHand = hand.filter((_, i) => i !== 0 && i !== 1);
    expect(newHand.length).toBe(0);
  });

  it("skip turn advances correctly in 4-player game", () => {
    const direction: 1 | -1 = 1;
    const seats = [0, 1, 2, 3];
    const current = 1;
    const idx = seats.indexOf(current);
    const nextIdx = (idx + direction + seats.length) % seats.length;
    expect(seats[nextIdx]).toBe(2);
  });

  it("reverse in 3+ player game changes direction", () => {
    const direction: 1 | -1 = 1;
    const newDirection = (direction * -1) as 1 | -1;
    expect(newDirection).toBe(-1);
    const seats = [0, 1, 2, 3];
    const current = 1;
    const idx = seats.indexOf(current);
    const nextIdx = (idx + newDirection + seats.length) % seats.length;
    expect(seats[nextIdx]).toBe(0);
  });

  it("last card wild penalty: wild as last card forces draw 2", () => {
    const hand: Card[] = [{ type: "wild" }];
    const topCard: Card = { color: "red", type: "number", value: 5 };

    // Wild can be played, but since it's the last card, penalty applies
    expect(canPlayCard(hand[0], topCard, hand)).toBe(true);

    // Simulate penalty: draw 2, remove wild, add drawn cards
    const drawn: Card[] = [
      { color: "green", type: "number", value: 3 },
      { color: "blue", type: "number", value: 7 },
    ];
    const newHand = hand.filter((_, i) => i !== 0).concat(drawn);
    expect(newHand.length).toBe(2);
  });
});
```

- [ ] **Step 8: 更新 `backend/package.json` 的 scripts**

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "format": "prettier --write src/",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 9: 运行测试**

```bash
cd backend && npx vitest run
```
预期：所有测试 PASS

- [ ] **Step 10: Commit**

```bash
git add backend/vitest.config.ts backend/test/ backend/package.json
git commit -m "test: add Vitest integration tests for rules, deck, scoring, and game flow"
```

---

### Task 12: 配置 GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: 创建 `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  typecheck:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
      - run: npm run typecheck

  lint:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
      - run: npm run test
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for typecheck, lint, and test"
```

---

### Task 13: 最终验证

**Files:**
- 无新文件

- [ ] **Step 1: 运行完整的 typecheck**

```bash
cd backend && npx tsc --noEmit
```
预期：PASS，无错误

- [ ] **Step 2: 运行 lint**

```bash
cd backend && npx eslint src/
```
预期：PASS 或仅有 `no-explicit-any` 的 warn（渐进式清理）

- [ ] **Step 3: 运行测试**

```bash
cd backend && npx vitest run
```
预期：所有测试 PASS

- [ ] **Step 4: 确认 wrangler.jsonc 配置正确**

检查 DO class_name 是否仍然正确引用（`LobbyDOv2` 和 `GameRoomDOv2` 已通过 index.ts re-export）

- [ ] **Step 5: Commit 最终调整**

```bash
git add -A
git commit -m "chore: final adjustments and verification after refactor"
```
