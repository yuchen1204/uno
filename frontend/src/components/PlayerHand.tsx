import { Card as CardType, CardColor } from "../types";
import { canPlayCard } from "../../../shared/rules";
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