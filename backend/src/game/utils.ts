import { Card, PlayerFull } from "../types";
import { shuffleDeck } from "./deck";
import type { GameStateRow } from "../env";

export function getNextSeat(current: number, direction: 1 | -1, players: PlayerFull[]): number {
  const seats = players.map(p => p.seatIndex).sort((a, b) => a - b);
  const idx = seats.indexOf(current);
  if (idx === -1) return seats[0];
  const nextIdx = (idx + direction + seats.length) % seats.length;
  return seats[nextIdx];
}

export function advanceToNext(
  sql: SqlStorage,
  state: GameStateRow,
  players: PlayerFull[]
): void {
  const nextSeat = getNextSeat(state.current_seat!, state.direction as 1 | -1, players);
  sql.exec("UPDATE game_state SET current_seat = ? WHERE id = 1", nextSeat);
}

export function reshuffleDiscard(
  deck: Card[],
  discardPileStr: string,
  sql: SqlStorage
): Card[] | null {
  const discardPile = JSON.parse(discardPileStr) as Card[];
  if (discardPile.length < 2) return null;
  const topDiscard = discardPile[discardPile.length - 1];
  const reshuffleCards = discardPile.slice(0, -1);
  const newDeck = shuffleDeck(reshuffleCards);
  sql.exec(
    "UPDATE game_state SET deck = ?, discard_pile = ? WHERE id = 1",
    JSON.stringify(newDeck),
    JSON.stringify([topDiscard])
  );
  return newDeck;
}