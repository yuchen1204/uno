import { DurableObject } from "cloudflare:workers";
import { handleRegister, handleLogin, handleMe, authenticateRequest } from "./auth";
import { handleCreateRoom, handleListRooms, handleRoomDetail } from "./rooms";
import { handleLeaderboard } from "./leaderboard";
import { Card, CardColor, GameState, PlayerFull, PlayerInfo } from "./types";
import { createDeck, shuffleDeck, dealCards, cardToScore } from "./game/deck";
import { canPlayCard } from "./game/rules";
import { calculateHandScore } from "./game/scoring";

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

export class GameRoomDO extends DurableObject<Env> {
  pendingStreams: WritableStream[] = [];
  disconnectTimers: Map<number, number> = new Map();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room_config (
          code TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          max_players INTEGER DEFAULT 4,
          min_players INTEGER DEFAULT 2,
          status TEXT NOT NULL DEFAULT 'waiting'
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
          score INTEGER DEFAULT 0,
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

    let deck = shuffleDeck(createDeck());

    for (const player of players) {
      const { cards, remaining } = dealCards(deck, 7);
      deck = remaining;
      this.ctx.storage.sql.exec(
        "UPDATE players SET hand = ? WHERE seat_index = ?",
        JSON.stringify(cards),
        player.seat_index,
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

    this.ctx.storage.sql.exec(
      "UPDATE game_state SET phase = 'playing', current_seat = 0, direction = 1, top_card = ?, deck = ?, discard_pile = '[]', wild_color = ?, draw_accumulated = 0 WHERE id = 1",
      JSON.stringify(topCard),
      JSON.stringify(deck),
      wildColor || null,
    );

    this.ctx.storage.sql.exec("UPDATE room_config SET status = 'playing'");
    await this.updateD1RoomStatus(config.code, "playing");

    this.broadcastState();
    return { success: true };
  }

  async playerAction(seatIndex: number, action: string, payload?: any): Promise<{ success: boolean; error?: string; scoreChange?: number; targetSeat?: number }> {
    const gameState = this.getGameState();
    if (!gameState || gameState.phase !== "playing") {
      return { success: false, error: "游戏未进行中" };
    }
    if (gameState.current_seat !== seatIndex) {
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
      return { success: true };
    }
    return { success: false, error: "无效操作" };
  }

  private handleDrawCard(player: PlayerFull, players: PlayerFull[], state: any): { success: boolean; error?: string; scoreChange?: number } {
    const deck = JSON.parse(state.deck) as Card[];
    const wildColor = state.wild_color ? (state.wild_color as CardColor) : undefined;
    const topCard = JSON.parse(state.top_card) as Card;

    const canPlay = player.hand.some(c => canPlayCard(c, topCard, player.hand, wildColor));
    if (canPlay) {
      return { success: false, error: "你还有可出的牌，不能摸牌" };
    }

    if (deck.length === 0) {
      return { success: false, error: "牌堆已空" };
    }
    const drawnCard = deck[0];
    const newDeck = deck.slice(1);
    const newHand = [...player.hand, drawnCard];

    this.updatePlayerHand(player.seatIndex, newHand);
    this.updateDeck(newDeck);

    if (canPlayCard(drawnCard, topCard, [drawnCard], wildColor)) {
      const playCard = newHand.pop()!;
      return this.executePlayCard(player, players, state, playCard, { seatIndex: player.seatIndex, hand: newHand, deck: newDeck, topCard, wildColor });
    }

    this.advanceToNext(state, players);
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
    ctxData: { seatIndex: number; hand: Card[]; deck: Card[]; topCard: Card; wildColor?: CardColor; chosenColor?: CardColor }
  ): { success: boolean; error?: string; scoreChange?: number; targetSeat?: number } {
    const filteredHand = ctxData.hand.filter((c, i) => {
      if (card.type === "number" && card.value !== undefined) {
        return !(ctxData.hand[i].type === "number" && ctxData.hand[i].value === card.value && ctxData.hand[i].color === card.color);
      }
      if (card.type === "wild" || card.type === "wild4") {
        return !(ctxData.hand[i].type === card.type);
      }
      return !(ctxData.hand[i].type === card.type && ctxData.hand[i].color === card.color);
    });

    this.updatePlayerHand(player.seatIndex, filteredHand);

    let newDeck = ctxData.deck;
    const discardPile = JSON.parse(state.discard_pile) as Card[];
    discardPile.push(ctxData.topCard);

    let nextSeat = this.getNextSeat(ctxData.seatIndex, state.direction, players);
    let newDirection = state.direction;
    let scoreChange = 0;
    let targetSeat: number | undefined;
    let wildColor = ctxData.wildColor;
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
      wildColor = ctxData.chosenColor;
    } else if (card.type === "wild4") {
      targetSeat = nextSeat;
      scoreChange = 50;
      this.drawCards(nextSeat, 4);
      wildColor = ctxData.chosenColor;
      skipAfter = true;
    }

    const updatedCurrentSeat = skipAfter ? this.getNextSeat(nextSeat, newDirection, players) : nextSeat;

    this.ctx.storage.sql.exec(
      "UPDATE game_state SET phase = 'playing', current_seat = ?, direction = ?, top_card = ?, deck = ?, discard_pile = ?, wild_color = ?, draw_accumulated = ? WHERE id = 1",
      updatedCurrentSeat,
      newDirection,
      JSON.stringify(card),
      JSON.stringify(newDeck),
      JSON.stringify(discardPile),
      wildColor || null,
      0,
    );

    if (filteredHand.length === 0) {
      this.finishGame(player.seatIndex, players, cardToScore(card), scoreChange);
      return { success: true, scoreChange, targetSeat };
    }

    if (targetSeat !== undefined && scoreChange > 0) {
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
    const gameState = this.getGameState();
    const deck = JSON.parse(gameState.deck) as Card[];
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
    this.ctx.storage.sql.exec("UPDATE room_config SET status = 'finished'");

    const config = this.ctx.storage.sql.exec("SELECT type FROM room_config").one() as any;
    if (config && config.type !== "quick" && this.env) {
      const winner = players.find(p => p.seatIndex === winnerSeat);
      if (winner?.user_id) {
        try {
          await this.env.DB.prepare("UPDATE users SET score = score + ? WHERE id = ?")
            .bind(totalScore, winner.user_id)
            .run();
        } catch (e) {}
      }
    }

    await this.updateD1RoomStatus(config?.code || "", "finished");
    this.broadcastState();
  }

  private addScoreToTarget(seatIndex: number, amount: number, players: PlayerFull[]): void {
    const player = players.find(p => p.seatIndex === seatIndex);
    if (player?.user_id && this.env) {
      this.env.DB.prepare("UPDATE users SET score = score + ? WHERE id = ?")
        .bind(amount, player.user_id)
        .run()
        .catch(() => {});
    }
  }

  private async updateD1RoomStatus(code: string, status: string): Promise<void> {
    if (this.env && code) {
      this.env.DB.prepare("UPDATE rooms SET status = ? WHERE code = ?")
        .bind(status, code)
        .run()
        .catch(() => {});
    }
  }

  private getGameState(): any {
    return this.ctx.storage.sql.exec("SELECT * FROM game_state WHERE id = 1").one() || null;
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

  private advanceToNext(state: any, players: PlayerFull[]): void {
    const nextSeat = this.getNextSeat(state.current_seat, state.direction, players);
    this.ctx.storage.sql.exec(
      "UPDATE game_state SET current_seat = ? WHERE id = 1",
      nextSeat,
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname.endsWith("/stream")) {
      const { readable, writable } = new TransformStream<Uint8Array>();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      const state = this.getFullStateForPlayer(-1);
      writer.write(encoder.encode(JSON.stringify(state) + "\n"));

      this.pendingStreams.push(writable);
      request.signal.onabort = () => {
        const idx = this.pendingStreams.indexOf(writable);
        if (idx >= 0) this.pendingStreams.splice(idx, 1);
        writer.close().catch(() => {});
      };

      return new Response(readable, {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  }

  async getFullStateForPlayer(seatIndex: number): Promise<GameState> {
    const gameState = this.getGameState();
    const players = this.getAllPlayers();

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

  async getPlayerHand(seatIndex: number): Promise<{ hand: Card[] }> {
    const player = this.getAllPlayers().find(p => p.seatIndex === seatIndex);
    if (!player) throw new Error("玩家不存在");
    return { hand: player.hand };
  }

  private broadcastState(): void {
    if (this.pendingStreams.length === 0) return;
    const state = this.getFullStateForPlayer(-1);
    const data = JSON.stringify(state) + "\n";
    const encoder = new TextEncoder();
    const message = encoder.encode(data);
    const closedIndexes: number[] = [];
    for (let i = 0; i < this.pendingStreams.length; i++) {
      try {
        const writer = this.pendingStreams[i].getWriter();
        writer.write(message);
        writer.releaseLock();
      } catch (e) {
        closedIndexes.push(i);
      }
    }
    for (const i of closedIndexes.reverse()) {
      this.pendingStreams.splice(i, 1);
    }
  }
}

async function handleGame(request: Request, env: Env, pathname: string): Promise<Response> {
  const parts = pathname.split("/");
  const code = parts[3];
  const action = parts[4];

  if (!code || code.length !== 6) {
    return Response.json({ error: "无效的房间码" }, { status: 400 });
  }

  const gameRoomId = env.GAME_ROOM_DO.idFromName(code);
  const stub = env.GAME_ROOM_DO.get(gameRoomId);

  if (action === "state") {
    const state = await stub.getFullStateForPlayer(-1);
    return Response.json(state);
  }

  if (action === "hand") {
    const url = new URL(request.url);
    const seatIndex = parseInt(url.searchParams.get("seat") || "-1");
    if (seatIndex < 0) return Response.json({ error: "缺少 seat 参数" }, { status: 400 });
    const result = await stub.getPlayerHand(seatIndex);
    return Response.json(result);
  }

  if (action === "start") {
    const result = await stub.startGame();
    return Response.json(result);
  }

  if (action === "action") {
    const body = await request.json<{ seatIndex: number; action: string; cardIndex?: number; color?: CardColor }>();
    const result = await stub.playerAction(body.seatIndex, body.action, { cardIndex: body.cardIndex, color: body.color });
    return Response.json(result);
  }

  if (action === "stream") {
    return stub.fetch(request);
  }

  return Response.json({ error: "无效的游戏操作" }, { status: 400 });
}

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
