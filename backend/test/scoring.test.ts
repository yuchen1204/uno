import { describe, it, expect } from "vitest";
import { calculateHandScore, calculateActionScore } from "../src/game/scoring";
import { Card } from "../src/types";

describe("calculateHandScore", () => {
  it("sums card scores", () => {
    const hand: Card[] = [
      { color: "red", type: "number", value: 5 },
      { color: "blue", type: "skip" },
      { type: "wild" },
    ];
    expect(calculateHandScore(hand)).toBe(5 + 20 + 50);
  });

  it("returns 0 for empty hand", () => {
    expect(calculateHandScore([])).toBe(0);
  });
});

describe("calculateActionScore", () => {
  it("skip/reverse = 20", () => {
    expect(calculateActionScore({ color: "red", type: "skip" })).toBe(20);
  });
  it("draw2 = 20", () => {
    expect(calculateActionScore({ color: "green", type: "draw2" })).toBe(20);
  });
  it("wild4 = 50", () => {
    expect(calculateActionScore({ type: "wild4" })).toBe(50);
  });
  it("number = 0", () => {
    expect(calculateActionScore({ color: "yellow", type: "number", value: 3 })).toBe(0);
  });
});