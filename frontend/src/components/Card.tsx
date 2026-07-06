import { Card as CardType, CardColor } from "../types";

interface Props {
  card: CardType;
  onClick?: () => void;
  small?: boolean;
  playable?: boolean;
  selected?: boolean;
}

const COLOR_LABELS: Record<CardColor, string> = {
  red: "红", yellow: "黄", blue: "蓝", green: "绿",
};

function getCardLabel(card: CardType): string {
  if (card.type === "number" && card.value !== undefined) return String(card.value);
  const labels: Record<string, string> = {
    skip: "⊘", reverse: "⇄", draw2: "+2", wild: "🌈", wild4: "+4",
  };
  return labels[card.type] || "?";
}

function getCardColor(card: CardType): string {
  if (card.type === "wild" || card.type === "wild4") return "wild";
  return card.color || "wild";
}

export default function CardComponent({ card, onClick, small, playable, selected }: Props) {
  const style: React.CSSProperties = small
    ? { width: 60, height: 90, fontSize: 12 }
    : { fontSize: 20 };

  const label = getCardLabel(card);

  return (
    <div
      className={`card ${getCardColor(card)} ${playable ? "playable" : ""} ${selected ? "selected" : ""}`}
      style={style}
      onClick={onClick}
    >
      <div className="card-corner top-left">{label}</div>
      <div className="card-inner">
        <div className="value">{label}</div>
      </div>
      <div className="card-corner bottom-right">{label}</div>
    </div>
  );
}
