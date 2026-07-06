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