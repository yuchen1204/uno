import { Card, CardColor, CardType } from "../types";

const COLORS: CardColor[] = ["red", "yellow", "blue", "green"];

export function createDeck(): Card[] {
  const deck: Card[] = [];

  for (const color of COLORS) {
    deck.push({ color, type: "number", value: 0 });

    for (let v = 1; v <= 9; v++) {
      deck.push({ color, type: "number", value: v });
      deck.push({ color, type: "number", value: v });
    }

    for (const type of ["skip", "reverse", "draw2"] as CardType[]) {
      deck.push({ color, type });
      deck.push({ color, type });
    }
  }

  for (let i = 0; i < 4; i++) {
    deck.push({ type: "wild" });
    deck.push({ type: "wild4" });
  }

  return deck;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function dealCards(deck: Card[], count: number): { cards: Card[]; remaining: Card[] } {
  const cards = deck.slice(0, count);
  const remaining = deck.slice(count);
  return { cards, remaining };
}

export function cardToScore(card: Card): number {
  if (card.type === "number" && card.value !== undefined) return card.value;
  if (card.type === "skip" || card.type === "reverse" || card.type === "draw2") return 20;
  if (card.type === "wild" || card.type === "wild4") return 50;
  return 0;
}

export function cardToActionScore(card: Card): number {
  if (card.type === "skip" || card.type === "reverse") return 20;
  if (card.type === "draw2") return 20;
  if (card.type === "wild4") return 50;
  return 0;
}