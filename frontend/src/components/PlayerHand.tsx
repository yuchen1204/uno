import { Card as CardType } from "../types";
import CardComponent from "./Card";

interface Props {
  cards: CardType[];
  onPlayCard: (index: number) => void;
  disabled?: boolean;
}

export default function PlayerHand({ cards, onPlayCard, disabled }: Props) {
  return (
    <div className="player-hand">
      {cards.map((card, i) => (
        <CardComponent
          key={`${card.color || "wild"}-${card.type}-${card.value ?? ""}-${i}`}
          card={card}
          onClick={() => !disabled && onPlayCard(i)}
        />
      ))}
    </div>
  );
}
