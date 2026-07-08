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
  isReady: boolean;
  score: number;
  skipCount: number;
  isAi?: boolean;
  aiDifficulty?: string;
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
  roomType?: RoomType;
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

export interface LeaderboardEntry {
  username: string;
  score: number;
}
