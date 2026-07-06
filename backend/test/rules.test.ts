import { describe, it, expect } from "vitest";
import { canPlayCard } from "../src/game/rules";
import { Card, CardColor } from "../src/types";

const makeCard = (color: CardColor, type: string, value?: number): Card => ({
  color,
  type: type as Card["type"],
  value,
});

describe("canPlayCard", () => {
  it("allows same color match", () => {
    const hand: Card[] = [makeCard("red", "number", 5), makeCard("blue", "number", 3)];
    const topCard = makeCard("red", "number", 3);
    expect(canPlayCard(hand[0], topCard, hand)).toBe(true);
  });

  it("allows same number match across colors", () => {
    const hand: Card[] = [makeCard("blue", "number", 3)];
    const topCard = makeCard("red", "number", 3);
    expect(canPlayCard(hand[0], topCard, hand)).toBe(true);
  });

  it("allows same type match across colors", () => {
    const hand: Card[] = [{ color: "blue", type: "skip" }];
    const topCard = { color: "red", type: "skip" };
    expect(canPlayCard(hand[0], topCard, hand)).toBe(true);
  });

  it("allows wild card always", () => {
    const hand: Card[] = [{ type: "wild" }];
    const topCard = makeCard("red", "number", 5);
    expect(canPlayCard(hand[0], topCard, hand)).toBe(true);
  });

  it("allows wild4 always", () => {
    const hand: Card[] = [{ type: "wild4" }];
    const topCard = makeCard("green", "skip");
    expect(canPlayCard(hand[0], topCard, hand)).toBe(true);
  });

  it("rejects wrong color and number", () => {
    const hand: Card[] = [makeCard("blue", "number", 7)];
    const topCard = makeCard("red", "number", 3);
    expect(canPlayCard(hand[0], topCard, hand)).toBe(false);
  });

  it("respects wildColor for matching", () => {
    const hand: Card[] = [makeCard("blue", "number", 3)];
    const topCard: Card = { type: "wild" };
    const wildColor: CardColor = "blue";
    expect(canPlayCard(hand[0], topCard, hand, wildColor)).toBe(true);
  });

  it("draw2 defense: only draw2 or wild4 allowed under penalty", () => {
    const hand: Card[] = [
      { color: "red", type: "draw2" },
      { color: "red", type: "number", value: 5 },
      { type: "wild4" },
    ];
    const topCard = makeCard("red", "draw2");
    expect(canPlayCard(hand[0], topCard, hand, undefined, 2)).toBe(true);
    expect(canPlayCard(hand[1], topCard, hand, undefined, 2)).toBe(false);
    expect(canPlayCard(hand[2], topCard, hand, undefined, 2)).toBe(true);
  });

  it("respects minValue for number chains", () => {
    const hand: Card[] = [makeCard("red", "number", 6)];
    const topCard = makeCard("red", "number", 5);
    expect(canPlayCard(hand[0], topCard, hand, undefined, 0, 5)).toBe(true);
    const hand2: Card[] = [makeCard("red", "number", 4)];
    expect(canPlayCard(hand2[0], topCard, hand2, undefined, 0, 5)).toBe(false);
  });

  it("reverse matches same type across colors", () => {
    const hand: Card[] = [{ color: "green", type: "reverse" }];
    const topCard: Card = { color: "yellow", type: "reverse" };
    expect(canPlayCard(hand[0], topCard, hand)).toBe(true);
  });
});