export interface User {
  username: string;
  score: number;
}

export interface AuthResponse {
  token: string;
  username: string;
  score: number;
}

export type RoomType = "public" | "private" | "quick";

export interface Room {
  code: string;
  type: RoomType;
  status: "waiting" | "playing" | "finished";
  playerCount?: number;
  maxPlayers?: number;
}

export type CardColor = "red" | "yellow" | "blue" | "green";
export type CardType = "number" | "skip" | "reverse" | "draw2" | "wild" | "wild4";

export interface Card {
  color?: CardColor;
  type: CardType;
  value?: number;
}

export interface PlayerInfo {
  seatIndex: number;
  username: string;
  handCount: number;
  isHost: boolean;
  connected: boolean;
  score: number;
}

export interface GameState {
  phase: "waiting" | "playing" | "finished";
  currentSeat: number;
  direction: 1 | -1;
  topCard: Card;
  deckCount: number;
  wildColor?: CardColor;
  drawAccumulated: number;
  winnerSeat?: number;
  players: PlayerInfo[];
}

export interface LeaderboardEntry {
  username: string;
  score: number;
}
