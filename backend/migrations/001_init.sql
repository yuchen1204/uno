CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  host_id TEXT,
  status TEXT NOT NULL DEFAULT 'waiting',
  max_players INTEGER NOT NULL DEFAULT 4,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS quick_players (
  room_code TEXT NOT NULL,
  session_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  PRIMARY KEY (room_code, session_id)
);
