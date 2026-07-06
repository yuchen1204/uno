import { describe, it, expect } from "vitest";
import { createDeck, shuffleDeck, dealCards, cardToScore, cardToActionScore } from "../src/game/deck";

describe("createDeck", () => {
  it("creates 108 cards", () => {
    const deck = createDeck();
    expect(deck.length).toBe(108);
  });

  it("contains 4 wild cards", () => {
    const deck = createDeck();
    expect(deck.filter(c => c.type === "wild").length).toBe(4);
  });

  it("contains 4 wild4 cards", () => {
    const deck = createDeck();
    expect(deck.filter(c => c.type === "wild4").length).toBe(4);
  });
});

describe("shuffleDeck", () => {
  it("returns same length", () => {
    const deck = createDeck();
    const shuffled = shuffleDeck(deck);
    expect(shuffled.length).toBe(deck.length);
  });

  it("does not mutate original", () => {
    const deck = createDeck();
    const original = [...deck];
    shuffleDeck(deck);
    expect(deck).toEqual(original);
  });
});

describe("dealCards", () => {
  it("deals correct count", () => {
    const deck = createDeck();
    const { cards, remaining } = dealCards(deck, 7);
    expect(cards.length).toBe(7);
    expect(remaining.length).toBe(108 - 7);
  });
});

describe("cardToScore", () => {
  it("number cards score face value", () => {
    expect(cardToScore({ color: "red", type: "number", value: 5 })).toBe(5);
    expect(cardToScore({ color: "blue", type: "number", value: 0 })).toBe(0);
  });

  it("action cards score 20", () => {
    expect(cardToScore({ color: "green", type: "skip" })).toBe(20);
    expect(cardToScore({ color: "yellow", type: "reverse" })).toBe(20);
    expect(cardToScore({ color: "red", type: "draw2" })).toBe(20);
  });

  it("wild cards score 50", () => {
    expect(cardToScore({ type: "wild" })).toBe(50);
    expect(cardToScore({ type: "wild4" })).toBe(50);
  });
});