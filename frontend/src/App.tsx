import { useState } from "react";
import { useAuth } from "./AuthContext";
import LoginModal from "./components/LoginModal";
import Lobby from "./components/Lobby";
import GameScreen from "./components/GameScreen";
import Leaderboard from "./components/Leaderboard";
import ErrorBoundary from "./components/ErrorBoundary";

export default function App() {
  const { user, loading } = useAuth();
  const [page, setPage] = useState<"lobby" | "game" | "leaderboard">(() => {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get("join");
    if (joinCode) {
      localStorage.setItem("uno_room_code", joinCode);
      return "game";
    }
    return (localStorage.getItem("uno_page") as any) || "lobby";
  });
  const [roomCode, setRoomCode] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get("join");
    if (joinCode) return joinCode;
    return localStorage.getItem("uno_room_code");
  });

  const navigateTo = (newPage: "lobby" | "game" | "leaderboard") => {
    setPage(newPage);
    localStorage.setItem("uno_page", newPage);
  };

  const updateRoomCode = (code: string | null) => {
    setRoomCode(code);
    if (code) {
      localStorage.setItem("uno_room_code", code);
    } else {
      localStorage.removeItem("uno_room_code");
    }
  };

  if (loading) return <div className="loading">加载中...</div>;

  return (
    <div className="app">
      <header className="app-header">
        <h1>UNO</h1>
        <nav>
          <button onClick={() => navigateTo("lobby")}>大厅</button>
          <button onClick={() => navigateTo("leaderboard")}>排行榜</button>
          {user && <span className="user-info">{user.username} ({user.score}分)</span>}
        </nav>
      </header>

      <main className="app-main">
        <ErrorBoundary>
          {page === "lobby" && (
          <Lobby
            onJoinGame={(code) => {
              updateRoomCode(code);
              navigateTo("game");
            }}
          />
        )}
        {page === "game" && roomCode && (
          <GameScreen
            code={roomCode}
            onLeave={() => {
              updateRoomCode(null);
              navigateTo("lobby");
            }}
          />
        )}
        {page === "leaderboard" && <Leaderboard />}
        </ErrorBoundary>
      </main>
    </div>
  );
}
