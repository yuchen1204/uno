import { useState } from "react";
import { api } from "../api";
import { RoomType } from "../types";
import { useAuth } from "../AuthContext";

interface Props {
  onClose: () => void;
  onCreated: (code: string) => void;
}

export default function CreateRoomModal({ onClose, onCreated }: Props) {
  const { user } = useAuth();
  const [type, setType] = useState<RoomType>("public");
  const [maxPlayers, setMaxPlayers] = useState<number>(4);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isLoggedIn = !!user;

  const handleCreate = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await api.createRoom(
        type,
        type === "quick" ? user!.username : undefined,
        maxPlayers
      );
      onCreated(result.code);
    } catch (err: any) {
      setError(err.message || "创建失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>创建房间</h2>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", marginBottom: 8 }}>
            <input type="radio" checked={type === "public"} onChange={() => setType("public")} />
            公开房间（显示在房间列表）
          </label>
          <label style={{ display: "block", marginBottom: 8 }}>
            <input type="radio" checked={type === "private"} onChange={() => setType("private")} />
            私有房间（仅链接加入，需登录）
          </label>
          <label style={{ display: "block", marginBottom: 8 }}>
            <input type="radio" checked={type === "quick"} onChange={() => setType("quick")} />
            快速房间（仅链接加入，不登录，不积分）
          </label>
        </div>

        <div style={{ marginBottom: 16 }}>
          <h4>最大人数</h4>
          <label style={{ marginRight: 16 }}>
            <input type="radio" checked={maxPlayers === 2} onChange={() => setMaxPlayers(2)} /> 2人
          </label>
          <label style={{ marginRight: 16 }}>
            <input type="radio" checked={maxPlayers === 3} onChange={() => setMaxPlayers(3)} /> 3人
          </label>
          <label>
            <input type="radio" checked={maxPlayers === 4} onChange={() => setMaxPlayers(4)} /> 4人
          </label>
        </div>

        {error && <div className="error">{error}</div>}

        <button onClick={handleCreate} disabled={loading}>
          {loading ? "创建中..." : "创建"}
        </button>
        <button className="secondary" onClick={onClose}>取消</button>
      </div>
    </div>
  );
}
