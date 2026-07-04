import { v4 as uuidv4 } from "uuid";
import type { Env } from "./index";
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
      if (!nickname || nickname.trim().length === 0) {
        return Response.json({ error: "快速房间需要设置用户标识符" }, { status: 400 });
      }
      username = nickname.trim();
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
  const code = parts[3];
  if (!code || code.length !== 6) {
    return Response.json({ error: "无效的房间码" }, { status: 400 });
  }

  if (parts[4] === "join") {
    return handleJoinRoom(code, request, env);
  }

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
    const nick = request.headers.get("X-Uno-Nickname") || "Guest";
    username = nick;
  }

  const gameRoomId = env.GAME_ROOM_DO.idFromName(code);
  const gameStub = env.GAME_ROOM_DO.get(gameRoomId);
  const joinResult = await gameStub.joinGame(username, userId);

  if (room.type === "public") {
    const lobbyId = env.LOBBY_DO.idFromName("global");
    const lobbyStub = env.LOBBY_DO.get(lobbyId);
    await lobbyStub.updatePlayerCount(code, joinResult.playerCount);
  }

  return Response.json({ ...joinResult, code });
}