import { PlayerInfo } from "../types";

interface Props {
  players: PlayerInfo[];
  currentSeat: number;
  localSeat: number;
}

export default function PlayerList({ players, currentSeat, localSeat }: Props) {
  const otherPlayers = players.filter(p => p.seatIndex !== localSeat);
  const localPlayer = players.find(p => p.seatIndex === localSeat);

  return (
    <>
      <div className="players-top">
        {otherPlayers.map(p => (
          <div key={p.seatIndex} className={`player-info ${p.seatIndex === currentSeat ? "active" : ""}`}>
            <div className="name">{p.username} {p.isHost ? "👑" : ""}</div>
            <div className="cards">{p.handCount} 张牌</div>
            <div className="seat">座位 {p.seatIndex + 1}</div>
          </div>
        ))}
      </div>
      {localPlayer && (
        <div className="player-info" style={{ marginTop: 8 }}>
          <div className="name">{localPlayer.username} (你) {localPlayer.isHost ? "👑" : ""}</div>
          <div className="cards">{localPlayer.handCount} 张牌</div>
        </div>
      )}
    </>
  );
}
