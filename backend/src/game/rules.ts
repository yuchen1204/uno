import { Card, CardColor } from "../types";

export function canPlayCard(
  card: Card,
  topCard: Card,
  hand: Card[],
  wildColor?: CardColor,
  drawAccumulated: number = 0,
  minValue: number = -1
): boolean {
  const drawAcc = drawAccumulated ?? 0;
  const minVal = minValue ?? -1;

  const effectiveColor = wildColor || topCard.color;

  if (drawAcc > 0) {
    if (card.type === "wild4") return true;
    if (card.type === "draw2" && card.color === effectiveColor) return true;
    return false;
  }

  if (card.type === "wild" || card.type === "wild4") return true;

  const matchColor = wildColor || topCard.color;

  // Same color rules
  if (card.color === matchColor) {
    // Action cards (skip, reverse, draw2) can always be played on same color
    if (card.type !== "number") return true;

    // Number cards
    if (card.type === "number" && card.value !== undefined) {
      if (minVal >= 0) {
        if (card.value === minVal + 1) return true;
        // Not in chain — fall through to normal same-color rule
      }
      // No minValue chain (or chain didn't match): must be >= top card's number
      if (topCard.type === "number" && topCard.value !== undefined) {
        return card.value >= topCard.value;
      }
      return true;
    }
  }

  // Different color: matching number/type always allowed
  if (card.type === "draw2" && topCard.type === "draw2") return true;
  if (card.type === "number" && topCard.type === "number" && card.value === topCard.value) return true;
  if (card.type !== "number" && topCard.type !== "number" && card.type === topCard.type) return true;

  return false;
}

export function getEffectiveTopCard(topCard: Card, wildColor?: CardColor): Card {
  if (topCard.type === "wild" || topCard.type === "wild4") {
    return { ...topCard, color: wildColor };
  }
  return topCard;
}