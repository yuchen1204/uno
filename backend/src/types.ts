export interface User {
  id: string;
  username: string;
  password: string;
  score: number;
  created_at: string;
}

export interface Session {
  userId: string;
  username: string;
  createdAt: string;
  expiresAt: string;
}

export interface Room {
  code: string;
  type: "public" | "private" | "quick";
  host_id: string | null;
  status: "waiting" | "playing" | "finished";
  created_at: string;
  finished_at?: string;
}

export interface QuickPlayer {
  room_code: string;
  session_id: string;
  nickname: string;
}

export type CardColor = "red" | "yellow" | "blue" | "green";
export type CardType = "number" | "skip" | "reverse" | "draw2" | "wild" | "wild4";

export interface Card {
  color?: CardColor;
  type: CardType;
  value?: number;
}

export interface GameState {
  phase: "waiting" | "countdown" | "playing" | "finished";
  currentSeat: number;
  direction: 1 | -1;
  topCard: Card;
  deckCount: number;
  wildColor?: CardColor;
  drawAccumulated: number;
  winnerSeat?: number;
  countdownEnd?: number;
  minValue?: number;
  roomType?: "public" | "private" | "quick";
  maxPlayers?: number;
  players: PlayerInfo[];
  playHistory?: PlayHistory[];
  voidProposalSeat?: number;
  voidProposalTimeout?: number;
  voided?: boolean;
}

export interface PlayHistory {
  seatIndex: number;
  username: string;
  card: Card;
  timestamp: number;
  comboCard?: Card;
}

export interface PlayerInfo {
  seatIndex: number;
  username: string;
  handCount: number;
  isHost: boolean;
  connected: boolean;
  isReady: boolean;
  score: number;
  skipCount: number;
}

export interface PlayerFull {
  seatIndex: number;
  userId: string | null;
  username: string;
  hand: Card[];
  isHost: boolean;
  connected: boolean;
  isReady: boolean;
  score: number;
  skipCount: number;
  isAi: boolean;
  aiDifficulty?: string;
}
