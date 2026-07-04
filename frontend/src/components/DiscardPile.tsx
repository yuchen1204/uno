import { Card } from "../types";
import CardComponent from "./Card";

interface Props {
  card?: Card;
}

export default function DiscardPile({ card }: Props) {
  return (
    <div className="discard-pile">
      {card ? <CardComponent card={card} /> : <span style={{ color: "#888" }}>空</span>}
    </div>
  );
}
