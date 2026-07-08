export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  LOBBY_DO: DurableObjectNamespace;
  GAME_ROOM_DO: DurableObjectNamespace;
}

export interface PlayerRow extends Record<string, SqlStorageValue> {
  seat_index: number;
  user_id: string | null;
  username: string;
  hand: string;
  is_host: number;
  connected: number;
  is_ready: number;
  score: number;
  skip_count: number;
  seat_token: string;
  joined_at: string;
  is_ai: number;
  ai_difficulty: string | null;
}

export interface PlayerBasicRow extends Record<string, SqlStorageValue> {
  seat_index: number;
  user_id: string | null;
  username: string;
  is_host: number;
}

export interface GameStateRow extends Record<string, SqlStorageValue> {
  id: number;
  phase: string;
  current_seat: number | null;
  direction: number;
  top_card: string | null;
  deck: string;
  discard_pile: string;
  wild_color: string | null;
  draw_accumulated: number;
  winner_seat: number | null;
  countdown_end: number | null;
  min_value: number;
  void_proposal_seat: number | null;
  void_proposal_timeout: number | null;
  voided: number;
}

export interface RoomConfigRow extends Record<string, SqlStorageValue> {
  code: string;
  type: string;
  max_players: number;
  min_players: number;
  status: string;
  last_activity: number;
}

export interface PlayHistoryRow extends Record<string, SqlStorageValue> {
  seat_index: number;
  username: string;
  card: string;
  timestamp: number;
  combo_card: string | null;
}