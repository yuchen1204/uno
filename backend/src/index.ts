import { handleRegister, handleLogin, handleMe } from "./auth";
import { handleCreateRoom, handleListRooms, handleRoomDetail } from "./rooms";
import { handleLeaderboard } from "./leaderboard";
import { CardColor } from "./types";
import {
  ROOM_CODE_LENGTH,
} from "../../shared/constants";
import type { Env } from "./env";
import type { GameRoomDOv2 } from "./game/game-room-do";

export { LobbyDOv2 } from "./game/lobby-do";
export { GameRoomDOv2 } from "./game/game-room-do";

async function handleGame(request: Request, env: Env, pathname: string): Promise<Response> {
  const parts = pathname.split("/");
  const code = parts[3];
  const action = parts[4];

  if (!code || code.length !== ROOM_CODE_LENGTH) {
    return Response.json({ error: "无效的房间码" }, { status: 400 });
  }

  const gameRoomId = env.GAME_ROOM_DO.idFromName(code);
  const stub = env.GAME_ROOM_DO.get(gameRoomId) as unknown as DurableObjectStub<GameRoomDOv2>;

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
    await request.json<{ seatIndex: number }>();
    const result = await stub.handleStartGame();
    return Response.json(result);
  }

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
    const result = await stub.playerAction(body.seatIndex, body.action, { cardIndex: body.cardIndex, color: body.color, comboCardIndex: body.comboCardIndex }, { username: verifyUsername, userId: verifyUserId, seatToken: verifySeatToken });
    return Response.json(result);
  }

  if (action === "stream") {
    return stub.fetch(request);
  }

  return Response.json({ error: "无效的游戏操作" }, { status: 400 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const { pathname } = url;

      if (pathname === "/api/auth/register") return await handleRegister(request, env);
      if (pathname === "/api/auth/login") return await handleLogin(request, env);
      if (pathname === "/api/auth/me") return await handleMe(request, env);
      if (pathname === "/api/rooms" && request.method === "POST") return await handleCreateRoom(request, env);
      if (pathname === "/api/rooms" && request.method === "GET") return await handleListRooms(request, env);
      if (pathname.startsWith("/api/rooms/")) return await handleRoomDetail(request, env, pathname);
      if (pathname === "/api/leaderboard") return await handleLeaderboard(request, env);
      if (pathname.startsWith("/api/game/")) return await handleGame(request, env, pathname);

      return new Response("Not Found", { status: 404 });
    } catch (e: any) {
      console.error("Unhandled error:", e);
      return Response.json({ error: "内部服务器错误" }, { status: 500 });
    }
  },
};
