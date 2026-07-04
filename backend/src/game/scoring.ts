import { Card } from "../types";
import { cardToScore, cardToActionScore } from "./deck";

export function calculateHandScore(hand: Card[]): number {
  return hand.reduce((sum, card) => sum + cardToScore(card), 0);
}

export function calculateActionScore(card: Card): number {
  return cardToActionScore(card);
}