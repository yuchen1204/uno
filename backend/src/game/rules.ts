import { Card, CardColor } from "../types";

export function canPlayCard(card: Card, topCard: Card, hand: Card[], wildColor?: CardColor): boolean {
  if (card.type === "wild") return true;

  if (card.type === "wild4") {
    const matchingColor = topCard.color || wildColor;
    if (matchingColor) {
      const hasColorMatch = hand.some(
        c => c.type !== "wild4" && c.type !== "wild" && (c.color === matchingColor || c.color === topCard.color)
      );
      if (hasColorMatch) return false;
    }
    return true;
  }

  const effectiveColor = wildColor || topCard.color;
  if (card.color === effectiveColor) return true;

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