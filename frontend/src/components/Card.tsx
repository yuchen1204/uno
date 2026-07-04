import { Card as CardType, CardColor } from "../types";

interface Props {
  card: CardType;
  onClick?: () => void;
  small?: boolean;
}

const COLOR_LABELS: Record<CardColor, string> = {
  red: "红", yellow: "黄", blue: "蓝", green: "绿",
};

function getCardLabel(card: CardType): string {
  if (card.type === "number" && card.value !== undefined) return String(card.value);
  const labels: Record<string, string> = {
    skip: "跳", reverse: "反", draw2: "+2", wild: "变", wild4: "+4",
  };
  return labels[card.type] || "?";
}

function getCardColor(card: CardType): string {
  if (card.type === "wild" || card.type === "wild4") return "wild";
  return card.color || "wild";
}

export default function CardComponent({ card, onClick, small }: Props) {
  const style: React.CSSProperties = small
    ? { width: 56, height: 84, fontSize: 14 }
    : {};

  return (
    <div
      className={`card ${getCardColor(card)}`}
      style={style}
      onClick={onClick}
    >
      <div className="value">{getCardLabel(card)}</div>
      {card.color && (
        <div style={{ fontSize: 10, opacity: 0.7 }}>
          {COLOR_LABELS[card.color]}
        </div>
      )}
    </div>
  );
}
