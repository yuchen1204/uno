import type { Env } from "./index";

export async function handleLeaderboard(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 200);

  const rows = await env.DB.prepare(
    "SELECT username, score FROM users WHERE score > 0 ORDER BY score DESC LIMIT ?"
  ).bind(limit).all<{ username: string; score: number }>();

  return Response.json({ leaderboard: rows.results });
}