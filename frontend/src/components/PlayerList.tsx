import { PlayerInfo } from "../types";

interface Props {
  players: PlayerInfo[];
  currentSeat: number;
  localSeat: number;
  isHost?: boolean;
  onRemoveAi?: (seatIndex: number) => void;
}

export default function PlayerList({ players, currentSeat, localSeat, isHost, onRemoveAi }: Props) {
  const otherPlayers = players.filter(p => p.seatIndex !== localSeat);
  const localPlayer = players.find(p => p.seatIndex === localSeat);

  return (
    <div className="players-top">
      {otherPlayers.map(p => (
        <div key={p.seatIndex} className={`player-info ${p.seatIndex === currentSeat ? "active" : ""}`}>
          <div className="name">
            {p.username}
            {p.isAi && p.aiDifficulty && (
              <span className={`ai-badge ${p.aiDifficulty}`}>
                AI {p.aiDifficulty === "easy" ? "E" : p.aiDifficulty === "medium" ? "M" : "H"}
              </span>
            )}
            {p.isHost && !p.isAi ? " 👑" : ""}
            {!p.connected && <span style={{color: '#ff4444', fontSize: 12}}> (离线)</span>}
            {p.connected && p.isReady && <span style={{color: '#4caf50', fontSize: 12}}> (已准备)</span>}
          </div>
          <div className="cards">{p.handCount} 张牌</div>
          <div className="seat">座位 {p.seatIndex + 1}</div>
          {p.isAi && isHost && onRemoveAi && (
            <button className="remove-ai-btn" onClick={() => onRemoveAi(p.seatIndex)} title="移除 AI">
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}