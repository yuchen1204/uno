import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../AuthContext";
import { api } from "../api";
import { GameState, Card as CardType, CardColor } from "../types";
import PlayerHand from "./PlayerHand";
import DiscardPile from "./DiscardPile";
import PlayerList from "./PlayerList";
import ColorPicker from "./ColorPicker";

interface Props {
  code: string;
  onLeave: () => void;
}

export default function GameScreen({ code, onLeave }: Props) {
  const { user } = useAuth();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [localSeat, setLocalSeat] = useState<number>(-1);
  const [hand, setHand] = useState<CardType[]>([]);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [pendingCardIndex, setPendingCardIndex] = useState<number>(-1);
  const [error, setError] = useState("");
  const streamRef = useRef<AbortController | null>(null);

  const fetchHand = useCallback(async () => {
    if (localSeat < 0) return;
    try {
      const res = await api.getPlayerHand(code, localSeat);
      setHand(res.hand);
    } catch {}
  }, [code, localSeat]);

  const joinAndStream = useCallback(async () => {
    try {
      const joinRes = await api.joinRoom(code);
      setLocalSeat(joinRes.seatIndex);

      const state = await api.getGameState(code);
      setGameState(state);

      try {
        const handRes = await api.getPlayerHand(code, joinRes.seatIndex);
        setHand(handRes.hand);
      } catch {}

      const controller = new AbortController();
      streamRef.current = controller;

      const response = await fetch(`/api/game/${code}/stream`, {
        signal: controller.signal,
        headers: {
          ...(user ? { Authorization: `Bearer ${localStorage.getItem("uno_token")}` } : {}),
        },
      });

      const reader = response.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();

      const readLoop = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          const lines = text.split("\n").filter(Boolean);
          for (const line of lines) {
            try {
              const newState: GameState = JSON.parse(line);
              setGameState(newState);
            } catch {}
          }
          fetchHand();
        }
      };
      readLoop().catch(() => {});
    } catch (err: any) {
      setError(err.message || "加入游戏失败");
    }
  }, [code, user, fetchHand]);

  useEffect(() => {
    joinAndStream();
    return () => {
      streamRef.current?.abort();
    };
  }, [joinAndStream]);

  const handlePlayCard = (index: number) => {
    if (!gameState || gameState.currentSeat !== localSeat) return;
    const card = hand[index];
    if (!card) return;

    if (card.type === "wild" || card.type === "wild4") {
      setPendingCardIndex(index);
      setShowColorPicker(true);
      return;
    }

    doAction("play_card", index);
  };

  const handleColorSelect = async (color: CardColor) => {
    setShowColorPicker(false);
    await doAction("play_card", pendingCardIndex, color);
    setPendingCardIndex(-1);
  };

  const doAction = async (action: string, cardIndex?: number, color?: CardColor) => {
    try {
      const result = await api.playerAction(code, localSeat, action, cardIndex, color);
      if (!result.success) {
        setError(result.error || "操作失败");
        setTimeout(() => setError(""), 2000);
      }
      await fetchHand();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDraw = () => doAction("draw_card");

  const handleStart = async () => {
    try {
      const result = await api.startGame(code);
      if (!result.success) {
        setError(result.error || "开始失败");
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (error && !gameState) {
    return (
      <div className="game-screen">
        <p className="error">{error}</p>
        <button onClick={onLeave}>返回大厅</button>
      </div>
    );
  }

  if (!gameState) {
    return <div className="loading">加载游戏中...</div>;
  }

  const isMyTurn = gameState.currentSeat === localSeat;
  const isHost = gameState.players.find(p => p.seatIndex === localSeat)?.isHost;

  return (
    <div className="game-screen">
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="game-table">
        <PlayerList players={gameState.players} currentSeat={gameState.currentSeat} localSeat={localSeat} />

        <div className="center-area">
          <DiscardPile card={gameState.topCard} />
          <div className="deck" onClick={isMyTurn ? handleDraw : undefined}>
            {gameState.phase === "playing" ? `${gameState.deckCount}张` : ""}
          </div>
        </div>

        {gameState.phase === "playing" && (
          <PlayerHand
            cards={hand}
            onPlayCard={handlePlayCard}
            disabled={!isMyTurn}
          />
        )}

        {gameState.phase === "waiting" && isHost && (
          <button className="primary" onClick={handleStart} style={{ marginTop: 16 }}>
            开始游戏
          </button>
        )}

        {gameState.phase === "finished" && (
          <div className="finished-box">
            <h2>
              游戏结束！
              {gameState.winnerSeat === localSeat ? "你赢了！" : `座位 ${(gameState.winnerSeat ?? 0) + 1} 获胜`}
            </h2>
            <button onClick={onLeave}>返回大厅</button>
          </div>
        )}
      </div>

      {showColorPicker && <ColorPicker onSelect={handleColorSelect} />}
    </div>
  );
}
