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
