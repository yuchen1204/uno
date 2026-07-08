import { useState } from "react";
import { Card, PlayHistory } from "../types";
import CardComponent from "./Card";

interface Props {
  card?: Card;
  playHistory?: PlayHistory[];
}

export default function DiscardPile({ card, playHistory }: Props) {
  const [showHistory, setShowHistory] = useState(false);
  const hasHistory = playHistory && playHistory.length > 0;

  return (
    <>
      <div className="discard-pile" onClick={() => hasHistory && setShowHistory(!showHistory)} style={hasHistory ? { cursor: "pointer" } : undefined}>
        {card ? (
          <CardComponent
            key={`${card.color || "wild"}-${card.type}-${card.value ?? ""}`}
            card={card}
          />
        ) : (
          <span style={{ opacity: .4, fontFamily: "Bungee" }}>空</span>
        )}
        {hasHistory && (
          <div style={{
            position: "absolute",
            bottom: -8,
            right: -8,
            background: "var(--uno-red)",
            color: "white",
            fontSize: 10,
            fontWeight: "bold",
            borderRadius: "50%",
            width: 22,
            height: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            {playHistory.length}
          </div>
        )}
      </div>

      {showHistory && hasHistory && (
        <div className="modal-overlay" onClick={() => setShowHistory(false)}>
          <div className="modal history-modal" onClick={e => e.stopPropagation()}>
            <h2>出牌记录</h2>
            <div className="history-list">
              {[...playHistory].reverse().map((entry, i) => (
                <div key={i} className="history-entry">
                  <div className="history-user-info">
                    <span className="username" title={entry.username}>{entry.username}</span>
                    <span className="action">出了</span>
                  </div>
                  <div className="history-cards">
                    <CardComponent card={entry.card} small />
                    {entry.comboCard && (
                      <CardComponent card={entry.comboCard} small />
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button className="secondary" onClick={() => setShowHistory(false)} style={{ marginTop: 16, width: "100%" }}>
              关闭
            </button>
          </div>
        </div>
      )}
    </>
  );
}