import { useState, useEffect } from "react";
import { useAuth } from "../AuthContext";
import { api } from "../api";
import LoginModal from "./LoginModal";
import CreateRoomModal from "./CreateRoomModal";

interface Props {
  onJoinGame: (code: string) => void;
}

export default function Lobby({ onJoinGame }: Props) {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<{ code: string; playerCount: number; maxPlayers: number }[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");

  const loadRooms = async () => {
    try {
      const res = await api.listRooms();
      setRooms(res.rooms);
    } catch {}
  };

  useEffect(() => {
    loadRooms();
    const interval = setInterval(loadRooms, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleJoinByCode = async () => {
    if (!joinCode.trim()) return;
    setError("");
    try {
      await api.joinRoom(joinCode.trim().toUpperCase());
      onJoinGame(joinCode.trim().toUpperCase());
    } catch (err: any) {
      setError(err.message || "加入失败");
    }
  };

  if (!user) return <LoginModal />;

  return (
    <>
      <div className="lobby">
        <div className="room-list">
          <h2>公开房间</h2>
          {rooms.length === 0 ? (
            <p style={{ color: "#666" }}>暂无公开房间，创建一个吧</p>
          ) : (
            rooms.map(room => (
              <div
                key={room.code}
                className="room-item"
                onClick={async () => {
                  try {
                    await api.joinRoom(room.code);
                    onJoinGame(room.code);
                  } catch (err: any) {
                    setError(err.message);
                  }
                }}
              >
                <span className="room-code">{room.code}</span>
                <span>{room.playerCount}/{room.maxPlayers} 人</span>
              </div>
            ))
          )}
        </div>

        <div className="sidebar">
          <button className="primary" onClick={() => setShowCreate(true)}>
            创建房间
          </button>

          <div style={{ borderTop: "1px solid #333", paddingTop: 16 }}>
            <h3>输入房间码加入</h3>
            <input
              type="text"
              placeholder="6位房间码"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
              style={{
                display: "block",
                width: "100%",
                padding: 10,
                marginBottom: 8,
                background: "#1a1a2e",
                border: "1px solid #333",
                borderRadius: 6,
                color: "#eee",
                fontSize: 18,
                fontFamily: "monospace",
                textAlign: "center",
              }}
            />
            <button onClick={handleJoinByCode} style={{ width: "100%" }}>
              加入
            </button>
          </div>

          {error && <div className="error">{error}</div>}
        </div>
      </div>

      {showCreate && (
        <CreateRoomModal
          onClose={() => setShowCreate(false)}
          onCreated={(code) => {
            setShowCreate(false);
            onJoinGame(code);
          }}
        />
      )}
    </>
  );
}
