import { Card, CardColor, PlayerFull } from "../types";
import { canPlayCard } from "../../../shared/rules";
import { cardToScore } from "./deck";

export type AiDifficulty = "easy" | "medium" | "hard";

export interface AiDecision {
  action: "play_card" | "draw_card" | "skip_turn";
  cardIndex?: number;
  comboCardIndex?: number;
  color?: CardColor;
}

function getValidCards(hand: Card[], topCard: Card, wildColor: CardColor | undefined, drawAccumulated: number, minValue: number): number[] {
  return hand.reduce<number[]>((acc, card, i) => {
    if (canPlayCard(card, topCard, hand, wildColor, drawAccumulated, minValue)) {
      acc.push(i);
    }
    return acc;
  }, []);
}

function getValidColoredCards(hand: Card[]): number[] {
  return hand.reduce<number[]>((acc, card, i) => {
    if (card.color && card.type !== "wild" && card.type !== "wild4") {
      acc.push(i);
    }
    return acc;
  }, []);
}

function pickColorForWild(hand: Card[]): CardColor {
  const colorCount: Record<string, number> = { red: 0, yellow: 0, blue: 0, green: 0 };
  for (const card of hand) {
    if (card.color) colorCount[card.color]++;
  }
  const entries = Object.entries(colorCount) as [CardColor, number][];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function pickColorToHinderOpponent(hand: Card[], _players: PlayerFull[], _currentSeat: number): CardColor {
  const opponents = _players.filter(p => p.seatIndex !== _currentSeat);
  const worstOpponent = opponents.reduce((worst, p) => p.hand.length > (worst?.hand.length ?? 0) ? p : worst, opponents[0]);
  if (!worstOpponent) return pickColorForWild(hand);
  return pickColorForWild(hand);
}

// ===================== EASY STRATEGY =====================

function easyDecide(hand: Card[], validCards: number[], topCard: Card, wildColor: CardColor | undefined, drawAccumulated: number): AiDecision {
  if (validCards.length > 0) {
    const cardIndex = validCards[Math.floor(Math.random() * validCards.length)];
    const card = hand[cardIndex];

    if (card.type === "wild" || card.type === "wild4") {
      if (hand.length > 1 && Math.random() < 0.3) {
        const coloredCards = getValidColoredCards(hand);
        if (coloredCards.length > 0) {
          const comboIndex = coloredCards[Math.floor(Math.random() * coloredCards.length)];
          return {
            action: "play_card",
            cardIndex,
            comboCardIndex: comboIndex,
            color: (["red", "yellow", "blue", "green"] as CardColor[])[Math.floor(Math.random() * 4)],
          };
        }
      }
      return {
        action: "play_card",
        cardIndex,
        color: (["red", "yellow", "blue", "green"] as CardColor[])[Math.floor(Math.random() * 4)],
      };
    }

    return { action: "play_card", cardIndex };
  }

  return { action: "draw_card" };
}

// ===================== MEDIUM STRATEGY =====================

function mediumDecide(hand: Card[], validCards: number[], _topCard: Card, _wildColor: CardColor | undefined, _drawAccumulated: number): AiDecision {
  // 20% random chance to act non-optimally
  if (Math.random() < 0.2 && validCards.length > 0) {
    return easyDecide(hand, validCards, _topCard, _wildColor, _drawAccumulated);
  }

  if (validCards.length === 0) {
    return { action: "draw_card" };
  }

  // Score each valid card
  const scored = validCards.map(index => {
    const card = hand[index];
    let score = 0;

    // Prefer high-score cards (action cards)
    if (card.type === "draw2") score += 30;
    else if (card.type === "skip" || card.type === "reverse") score += 20;
    else if (card.type === "number") score += 5;

    // Penalize wild cards (save for later)
    if (card.type === "wild" || card.type === "wild4") score -= 10;

    // If only 1 card left, favor playing anything
    if (hand.length <= 2) score += 15;

    return { index, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const bestIndex = scored[0].index;
  const bestCard = hand[bestIndex];

  // Handle wild card combo
  if (bestCard.type === "wild" || bestCard.type === "wild4") {
    const coloredCards = getValidColoredCards(hand);
    if (coloredCards.length > 0 && hand.length > 1) {
      const comboScored = coloredCards.map(i => ({ index: i, score: cardToScore(hand[i]) }));
      comboScored.sort((a, b) => b.score - a.score);
      return {
        action: "play_card",
        cardIndex: bestIndex,
        comboCardIndex: comboScored[0].index,
        color: pickColorForWild(hand),
      };
    }
    return {
      action: "play_card",
      cardIndex: bestIndex,
      color: pickColorForWild(hand),
    };
  }

  return { action: "play_card", cardIndex: bestIndex };
}

// ===================== HARD STRATEGY =====================

function hardDecide(hand: Card[], validCards: number[], _topCard: Card, _wildColor: CardColor | undefined, drawAccumulated: number, players: PlayerFull[], currentSeat: number): AiDecision {
  if (validCards.length === 0) {
    return { action: "draw_card" };
  }

  // Score each valid card with advanced strategy
  const scored = validCards.map(index => {
    const card = hand[index];
    let score = 0;

    // Priority 1: Can we win immediately?
    if (hand.length === 1) {
      score += 1000;
    } else if (hand.length === 2 && card.type !== "wild" && card.type !== "wild4") {
      score += 500;
    }

    // Priority 2: Handle draw penalty — always defend
    if (drawAccumulated > 0) {
      if (card.type === "wild4") score += 200;
      else if (card.type === "draw2") score += 200;
    }

    // Priority 3: Action card value
    if (card.type === "draw2") score += 40;
    else if (card.type === "skip") score += 30;
    else if (card.type === "reverse") score += 25;

    // Priority 4: Conserve wild cards — only use if necessary
    if (card.type === "wild" || card.type === "wild4") {
      const hasNonWildPlayable = validCards.some(i => {
        const c = hand[i];
        return c.type !== "wild" && c.type !== "wild4";
      });
      if (hasNonWildPlayable) {
        score -= 100;
      } else {
        score += 50;
      }
    }

    // Priority 5: Prefer high numbers for point battle
    if (card.type === "number" && card.value !== undefined) {
      score += card.value;
    }

    return { index, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const bestIndex = scored[0].index;
  const bestCard = hand[bestIndex];

  if (bestCard.type === "wild" || bestCard.type === "wild4") {
    const coloredCards = getValidColoredCards(hand);
    if (coloredCards.length > 0 && hand.length > 1) {
      const comboScored = coloredCards.map(i => {
        const c = hand[i];
        return { index: i, score: c.value ?? 0 };
      });
      comboScored.sort((a, b) => b.score - a.score);
      return {
        action: "play_card",
        cardIndex: bestIndex,
        comboCardIndex: comboScored[0].index,
        color: pickColorToHinderOpponent(hand, players, currentSeat),
      };
    }
    return {
      action: "play_card",
      cardIndex: bestIndex,
      color: pickColorToHinderOpponent(hand, players, currentSeat),
    };
  }

  return { action: "play_card", cardIndex: bestIndex };
}

// ===================== MAIN DECISION ENTRY =====================

export function aiDecide(
  hand: Card[],
  topCard: Card,
  wildColor: CardColor | undefined,
  drawAccumulated: number,
  minValue: number,
  players: PlayerFull[],
  currentSeat: number,
  difficulty: AiDifficulty,
): AiDecision {
  const validCards = getValidCards(hand, topCard, wildColor, drawAccumulated, minValue);

  switch (difficulty) {
    case "easy":
      return easyDecide(hand, validCards, topCard, wildColor, drawAccumulated);
    case "medium":
      return mediumDecide(hand, validCards, topCard, wildColor, drawAccumulated);
    case "hard":
      return hardDecide(hand, validCards, topCard, wildColor, drawAccumulated, players, currentSeat);
  }
}

// ===================== VOID GAME RESPONSE =====================

export function evaluateHandQuality(hand: Card[]): number {
  if (hand.length === 0) return 0;

  // Factor 1: Hand size (0-1, fewer cards = better)
  const handSizeScore = Math.max(0, 1 - hand.length / 10);

  // Factor 2: Wild cards (having wild = flexibility = good)
  const wildCount = hand.filter(c => c.type === "wild" || c.type === "wild4").length;
  const wildScore = Math.min(1, wildCount / 2) * 0.3;

  // Factor 3: Total face value (lower = better)
  const totalValue = hand.reduce((sum, c) => sum + cardToScore(c), 0);
  const valueScore = Math.max(0, 1 - totalValue / 200) * 0.4;

  // Combined score: 0-1, higher = better hand
  return handSizeScore * 0.5 + wildScore + valueScore;
}

export function aiVoidResponse(
  hand: Card[],
  difficulty: AiDifficulty,
  proposerSeat: number,
  currentSeat: number,
  players: PlayerFull[],
): boolean {
  const handScore = evaluateHandQuality(hand);
  const handSize = hand.length;

  // Find the proposer's hand size
  const proposer = players.find(p => p.seatIndex === proposerSeat);
  const proposerHandSize = proposer?.hand.length ?? 7;

  // Special rules
  if (handSize <= 2) {
    return false;
  }
  if (proposerHandSize <= 2) {
    return true;
  }
  if (handSize > 5 && proposerHandSize <= 3) {
    return true;
  }

  // Threshold-based decision
  let threshold: number;
  switch (difficulty) {
    case "easy":
      threshold = 0.3;
      threshold += (Math.random() - 0.5) * 0.2;
      break;
    case "medium":
      threshold = 0.5;
      if (Math.random() < 0.1) return !(handScore < threshold);
      break;
    case "hard":
      threshold = 0.4;
      if (proposerHandSize <= handSize - 3) {
        threshold += 0.15;
      }
      break;
  }

  return handScore < threshold;
}