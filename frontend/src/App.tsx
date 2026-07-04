import { useState } from "react";
import { useAuth } from "./AuthContext";
import LoginModal from "./components/LoginModal";
import Lobby from "./components/Lobby";
import GameScreen from "./components/GameScreen";
import Leaderboard from "./components/Leaderboard";

export default function App() {
  const { user, loading } = useAuth();
  const [page, setPage] = useState<"lobby" | "game" | "leaderboard">("lobby");
  const [roomCode, setRoomCode] = useState<string | null>(null);

  if (loading) return <div className="loading">加载中...</div>;

  return (
    <div className="app">
      <header className="app-header">
        <h1>UNO</h1>
        <nav>
          <button onClick={() => setPage("lobby")}>大厅</button>
          <button onClick={() => setPage("leaderboard")}>排行榜</button>
          {user && <span className="user-info">{user.username} ({user.score}分)</span>}
        </nav>
      </header>

      <main className="app-main">
        {page === "lobby" && (
          <Lobby
            onJoinGame={(code) => {
              setRoomCode(code);
              setPage("game");
            }}
          />
        )}
        {page === "game" && roomCode && (
          <GameScreen
            code={roomCode}
            onLeave={() => {
              setRoomCode(null);
              setPage("lobby");
            }}
          />
        )}
        {page === "leaderboard" && <Leaderboard />}
      </main>
    </div>
  );
}
