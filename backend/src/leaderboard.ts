import type { Env } from "./env";
import { LEADERBOARD_DEFAULT_LIMIT, LEADERBOARD_MAX_LIMIT } from "../../shared/constants";

export async function handleLeaderboard(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || String(LEADERBOARD_DEFAULT_LIMIT)), LEADERBOARD_MAX_LIMIT);

  const rows = await env.DB.prepare(
    "SELECT username, score FROM users WHERE score > 0 ORDER BY score DESC LIMIT ?"
  ).bind(limit).all<{ username: string; score: number }>();

  return Response.json({ leaderboard: rows.results });
}