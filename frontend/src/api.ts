import { AuthResponse, Room, GameState, LeaderboardEntry, CardColor, Card } from "./types";

const API_BASE = "/api";

function getToken(): string | null {
  return localStorage.getItem("uno_token");
}

function setToken(token: string): void {
  localStorage.setItem("uno_token", token);
}

function clearToken(): void {
  localStorage.removeItem("uno_token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

export const api = {
  register(username: string, password: string): Promise<AuthResponse> {
    return request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },

  login(username: string, password: string): Promise<AuthResponse> {
    return request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },

  me(): Promise<{ username: string; score: number }> {
    return request("/auth/me");
  },

  isLoggedIn(): boolean {
    return !!getToken();
  },

  setToken(token: string): void {
    setToken(token);
  },

  clearToken(): void {
    clearToken();
  },

  createRoom(type: "public" | "private" | "quick", nickname?: string): Promise<{ code: string; type: string; hostName: string }> {
    return request("/rooms", {
      method: "POST",
      body: JSON.stringify({ type, nickname }),
    });
  },

  listRooms(): Promise<{ rooms: { code: string; playerCount: number; maxPlayers: number }[] }> {
    return request("/rooms");
  },

  getRoom(code: string): Promise<Room> {
    return request(`/rooms/${code}`);
  },

  joinRoom(code: string): Promise<{ seatIndex: number; playerCount: number }> {
    return request(`/rooms/${code}/join`);
  },

  getGameState(code: string): Promise<GameState> {
    return request(`/game/${code}/state`);
  },

  getPlayerHand(code: string, seatIndex: number): Promise<{ hand: Card[] }> {
    return request(`/game/${code}/hand?seat=${seatIndex}`);
  },

  startGame(code: string): Promise<{ success: boolean; error?: string }> {
    return request(`/game/${code}/start`, { method: "POST" });
  },

  playerAction(code: string, seatIndex: number, action: string, cardIndex?: number, color?: CardColor): Promise<any> {
    return request(`/game/${code}/action`, {
      method: "POST",
      body: JSON.stringify({ seatIndex, action, cardIndex, color }),
    });
  },

  getLeaderboard(limit?: number): Promise<{ leaderboard: LeaderboardEntry[] }> {
    const query = limit ? `?limit=${limit}` : "";
    return request(`/leaderboard${query}`);
  },
};
