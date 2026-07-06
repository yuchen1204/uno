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
    const { type, nickname, maxPlayers = 4 } = await request.json<{ type: "public" | "private" | "quick"; nickname?: string; maxPlayers?: number }>();
    if (!["public", "private", "quick"].includes(type)) {
      return Response.json({ error: "无效的房间类型" }, { status: 400 });
    }
    if (maxPlayers < 2 || maxPlayers > 4) {
      return Response.json({ error: "人数必须在2到4之间" }, { status: 400 });
    }

    let userId: string | null = null;
    let username = "Guest";
    
    const user = await authenticateRequest(request, env);
    if (!user) {
      return Response.json({ error: "需要登录" }, { status: 401 });
    }
    userId = user.userId;
    username = user.username;

    const code = generateRoomCode();
    const now = new Date().toISOString();

    await env.DB.prepare(
      "INSERT INTO rooms (code, type, host_id, status, max_players, created_at) VALUES (?, ?, ?, 'waiting', ?, ?)"
    ).bind(code, type, userId, maxPlayers, now).run();

    if (type === "public") {
      const lobbyId = env.LOBBY_DO.idFromName("global_v2");
      const lobbyStub = env.LOBBY_DO.get(lobbyId);
      await lobbyStub.addRoom(code, maxPlayers);
    }

    return Response.json({ code, type, hostName: username });
  } catch (e) {
    return Response.json({ error: "创建房间失败" }, { status: 500 });
  }
}

export async function handleListRooms(request: Request, env: Env): Promise<Response> {
  try {
    const lobbyId = env.LOBBY_DO.idFromName("global_v2");
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
  if (parts[4] === "leave") {
    return handleLeaveRoom(code, request, env);
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
    .first<{ code: string; type: string; status: string; max_players: number }>();
  if (!room) {
    const lobbyId = env.LOBBY_DO.idFromName("global_v2");
    const lobbyStub = env.LOBBY_DO.get(lobbyId);
    await lobbyStub.removeRoom(code);
    return Response.json({ error: "房间不存在" }, { status: 404 });
  }
  if (room.status === "finished") {
    if (room.type === "public") {
      const lobbyId = env.LOBBY_DO.idFromName("global_v2");
      const lobbyStub = env.LOBBY_DO.get(lobbyId);
      await lobbyStub.removeRoom(code);
    }
    return Response.json({ error: "游戏已结束" }, { status: 400 });
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
    const user = await authenticateRequest(request, env);
    if (user) {
      userId = user.userId;
      username = user.username;
    } else {
      const nick = request.headers.get("X-Uno-Nickname");
      if (!nick) {
        return Response.json({ error: "缺少昵称" }, { status: 400 });
      }
      username = nick;
    }
  }

  const gameRoomId = env.GAME_ROOM_DO.idFromName(code);
  const gameStub = env.GAME_ROOM_DO.get(gameRoomId);
  const joinResult = await gameStub.joinGame(code, username, userId, room.max_players, room.type);

  if (room.type === "public") {
    const lobbyId = env.LOBBY_DO.idFromName("global_v2");
    const lobbyStub = env.LOBBY_DO.get(lobbyId);
    await lobbyStub.updatePlayerCount(code, joinResult.playerCount);
  }

  return Response.json({ ...joinResult, code });
}

export async function handleLeaveRoom(code: string, request: Request, env: Env): Promise<Response> {
  const room = await env.DB.prepare("SELECT * FROM rooms WHERE code = ?")
    .bind(code)
    .first<{ code: string; type: string; status: string }>();
  if (!room) {
    return Response.json({ error: "房间不存在" }, { status: 404 });
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
    const user = await authenticateRequest(request, env);
    if (user) {
      userId = user.userId;
      username = user.username;
    } else {
      const nick = request.headers.get("X-Uno-Nickname");
      if (!nick) {
        return Response.json({ error: "缺少昵称" }, { status: 400 });
      }
      username = nick;
    }
  }

  const gameRoomId = env.GAME_ROOM_DO.idFromName(code);
  const gameStub = env.GAME_ROOM_DO.get(gameRoomId);
  const result = await gameStub.leaveGame(username, userId);

  if (result.success) {
    if (result.empty) {
      await env.DB.prepare("UPDATE rooms SET status = 'finished' WHERE code = ?").bind(code).run();
      if (room.type === "public") {
        const lobbyId = env.LOBBY_DO.idFromName("global_v2");
        const lobbyStub = env.LOBBY_DO.get(lobbyId);
        await lobbyStub.removeRoom(code);
      }
    } else if (room.type === "public") {
      const lobbyId = env.LOBBY_DO.idFromName("global_v2");
      const lobbyStub = env.LOBBY_DO.get(lobbyId);
      await lobbyStub.updatePlayerCount(code, result.playerCount || 0);
    }
  }

  return Response.json(result);
}