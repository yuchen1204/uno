import { Card as CardType, CardColor } from "../types";
import CardComponent from "./Card";

interface Props {
  cards: CardType[];
  onPlayCard: (index: number) => void;
  onSkip?: () => void;
  disabled?: boolean;
  topCard: CardType;
  wildColor?: CardColor;
  drawAccumulated?: number;
  minValue?: number;
  isSelectingCombo?: boolean;
  pendingCardIndex?: number;
}

export function canPlayCard(
  card: CardType,
  topCard: CardType,
  hand: CardType[],
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

  if (card.color === matchColor) {
    if (card.type !== "number") return true;
    if (card.type === "number" && card.value !== undefined) {
      if (minVal >= 0) {
        if (card.value === minVal + 1) return true;
      }
      if (topCard.type === "number" && topCard.value !== undefined) {
        return card.value >= topCard.value;
      }
      return true;
    }
  }

  if (card.type === "draw2" && topCard.type === "draw2") return true;
  if (card.type === "number" && topCard.type === "number" && card.value === topCard.value) return true;
  if (card.type !== "number" && topCard.type !== "number" && card.type === topCard.type) return true;

  return false;
}

export default function PlayerHand({ cards, onPlayCard, onSkip, disabled, topCard, wildColor, drawAccumulated = 0, minValue = -1, isSelectingCombo = false, pendingCardIndex = -1 }: Props) {
  return (
    <div className="player-hand">
      {onSkip && (
        <div
          className="card skip-card"
          onClick={onSkip}
        >
          <div className="card-inner skip-card-inner">
            <span className="skip-icon">⏭</span>
            <span className="skip-label">跳过</span>
          </div>
        </div>
      )}
      {cards.map((card, i) => {
        const playable = !disabled && (
          isSelectingCombo
            ? (card.type !== "wild" && card.type !== "wild4")
            : canPlayCard(card, topCard, cards, wildColor, drawAccumulated, minValue)
        );
        return (
          <CardComponent
            key={`${card.color || "wild"}-${card.type}-${card.value ?? ""}-${i}`}
            card={card}
            playable={playable}
            selected={i === pendingCardIndex}
            onClick={() => !disabled && (playable || i === pendingCardIndex) && onPlayCard(i)}
          />
        );
      })}
    </div>
  );
}