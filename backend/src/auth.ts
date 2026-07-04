import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { Session } from "./types";
import type { Env } from "./index";

function generateToken(): string {
  return uuidv4().replace(/-/g, "") + uuidv4().replace(/-/g, "");
}

async function createSession(userId: string, username: string, env: Env): Promise<string> {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
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
