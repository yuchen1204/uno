import { useState } from "react";
import { api } from "../api";
import { RoomType } from "../types";

interface Props {
  onClose: () => void;
  onCreated: (code: string) => void;
}

export default function CreateRoomModal({ onClose, onCreated }: Props) {
  const [type, setType] = useState<RoomType>("public");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setError("");
    if (type === "quick" && !nickname.trim()) {
      setError("快速房间需要设置用户标识符");
      return;
    }
    setLoading(true);
    try {
      const result = await api.createRoom(type, type === "quick" ? nickname : undefined);
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

        {type === "quick" && (
          <input
            type="text"
            placeholder="输入你的昵称"
            value={nickname}
            onChange={e => setNickname(e.target.value)}
          />
        )}

        {error && <div className="error">{error}</div>}

        <button onClick={handleCreate} disabled={loading}>
          {loading ? "创建中..." : "创建"}
        </button>
        <button className="secondary" onClick={onClose}>取消</button>
      </div>
    </div>
  );
}
