import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../AuthContext";
import { api } from "../api";
import { GameState, Card as CardType, CardColor } from "../types";
import PlayerHand, { canPlayCard } from "./PlayerHand";
import DiscardPile from "./DiscardPile";
import PlayerList from "./PlayerList";
import ColorPicker from "./ColorPicker";
import ConfirmModal from "./ConfirmModal";

interface Props {
  code: string;
  onLeave: () => void;
}

export default function GameScreen({ code, onLeave }: Props) {
  const { user } = useAuth();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [localSeat, setLocalSeat] = useState<number>(-1);
  const [hand, setHand] = useState<CardType[]>([]);
  const [pendingCardIndex, setPendingCardIndex] = useState<number>(-1);
  const [countdownText, setCountdownText] = useState("");
  const [notification, setNotification] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [tempNickname, setTempNickname] = useState("");
  const streamRef = useRef<AbortController | null>(null);
  const gameStateRef = useRef<GameState | null>(null);

  const showNotice = (msg: string) => {
    setNotification(msg);
    setTimeout(() => {
      setNotification(curr => curr === msg ? null : curr);
    }, 3000);
  };

  const fetchHand = useCallback(async () => {
    if (localSeat < 0) return;
    try {
      const res = await api.getPlayerHand(code, localSeat);
      setHand(res.hand);
    } catch {}
  }, [code, localSeat]);

  const joinAndStream = useCallback(async (nicknameOverride?: string) => {
    try {
      let nickname = user?.username || nicknameOverride;

      if (!nickname && !user) {
        try {
          const roomInfo = await api.getRoom(code);
          if (roomInfo.type === "quick") {
            setShowNicknameModal(true);
            return;
          }
        } catch (e) {
          // Ignore and let joinRoom fail
        }
      }

      const joinRes = await api.joinRoom(code, nickname);
      setLocalSeat(joinRes.seatIndex);
      setShowNicknameModal(false);

      const state = await api.getGameState(code);
      gameStateRef.current = state;
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
              const parsed = JSON.parse(line);
              // Check if this is a room_closed system message
              if (parsed.type === "room_closed") {
                setError(parsed.reason || "房间已关闭");
                setTimeout(() => onLeave(), 2000);
                return;
              }
              const newState: GameState = parsed;
              const oldState = gameStateRef.current;
              if (oldState) {
                // Check left or disconnected
                oldState.players.forEach(op => {
                  const np = newState.players.find(p => p.seatIndex === op.seatIndex);
                  if (!np) {
                    showNotice(`${op.username} 已离开游戏`);
                  } else if (op.connected && !np.connected) {
                    showNotice(`${op.username} 已断开连接 (离线)`);
                  } else if (!op.connected && np.connected) {
                    showNotice(`${op.username} 已重新连接`);
                  }
                });
                // Check joined
                newState.players.forEach(np => {
                  const op = oldState.players.find(p => p.seatIndex === np.seatIndex);
                  if (!op) {
                    showNotice(`${np.username} 加入了房间`);
                  }
                });
              }
              gameStateRef.current = newState;
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
  }, [code, user, fetchHand, onLeave]);

  useEffect(() => {
    joinAndStream();
    return () => {
      streamRef.current?.abort();
    };
  }, [joinAndStream]);

  useEffect(() => {
    if (gameState?.phase === "countdown" && gameState.countdownEnd) {
      const interval = setInterval(() => {
        const diff = gameState.countdownEnd! - Date.now();
        if (diff > 0) {
          setCountdownText(Math.ceil(diff / 1000).toString());
        } else {
          setCountdownText("开始！");
        }
      }, 100);
      return () => clearInterval(interval);
    } else {
      setCountdownText("");
    }
  }, [gameState]);

  const handlePlayCard = (index: number) => {
    if (!gameState || gameState.currentSeat !== localSeat) return;
    const card = hand[index];
    if (!card) return;

    if (pendingCardIndex === -1) {
      if (card.type === "wild" || card.type === "wild4") {
        if (hand.length === 1) {
          doAction("play_card", index);
        } else {
          setPendingCardIndex(index);
        }
      } else {
        doAction("play_card", index);
      }
    } else {
      if (index === pendingCardIndex) {
        setPendingCardIndex(-1);
        return;
      }
      if (card.type === "wild" || card.type === "wild4") {
        setError("连带丢出的卡牌不能是万能牌！");
        setTimeout(() => setError(""), 2000);
        return;
      }
      doAction("play_card", pendingCardIndex, undefined, index);
      setPendingCardIndex(-1);
    }
  };

  const doAction = async (action: string, cardIndex?: number, color?: CardColor, comboCardIndex?: number) => {
    try {
      const result = await api.playerAction(code, localSeat, action, cardIndex, color, comboCardIndex);
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

  const handleSkip = () => doAction("skip_turn");

  const handleReady = () => doAction("toggle_ready");

  const handleStartGame = async () => {
    try {
      const result = await api.startGame(code, localSeat);
      if (!result.success) {
        setError(result.error || "开始失败");
        setTimeout(() => setError(""), 2000);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };
  
  const handleContinue = () => doAction("continue_game");

  const handleLeaveRoom = async () => {
    setShowLeaveConfirm(false);
    try {
      await api.leaveRoom(code, user?.username);
      onLeave();
    } catch (err: any) {
      setError(err.message || "退出失败");
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

  if (showNicknameModal) {
    return (
      <div className="game-screen" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="modal" style={{ background: 'white', color: 'black', padding: 20, borderRadius: 8, width: 300 }}>
          <h2>加入快速房间</h2>
          <p style={{ marginBottom: 16 }}>设置一个游戏内显示的昵称</p>
          <input 
            type="text" 
            value={tempNickname} 
            onChange={e => setTempNickname(e.target.value)} 
            placeholder="你的昵称"
            style={{ width: '100%', marginBottom: 16, padding: 8 }}
          />
          <button onClick={() => {
            if (tempNickname.trim()) {
              joinAndStream(tempNickname.trim());
            }
          }} style={{ width: '100%' }}>进入房间</button>
          <button onClick={onLeave} className="secondary" style={{ width: '100%', marginTop: 8 }}>取消</button>
        </div>
      </div>
    );
  }

  if (!gameState) {
    return <div className="loading">加载游戏中...</div>;
  }

  const isMyTurn = gameState.currentSeat === localSeat;
  const localPlayer = gameState.players.find(p => p.seatIndex === localSeat);
  const localSkipCount = localPlayer?.skipCount ?? 0;

  const hasPlayableCard = Boolean(
    gameState.phase === "playing" &&
    gameState.topCard &&
    hand.some(c =>
      c.type !== "wild" && c.type !== "wild4" &&
      canPlayCard(c, gameState.topCard, hand, gameState.wildColor, gameState.drawAccumulated, gameState.minValue)
    )
  );
  const canDraw = isMyTurn && (!hasPlayableCard || localSkipCount >= 3);

  const getGameHint = () => {
    if (gameState.phase === "waiting") return "等待其他玩家准备...";
    if (gameState.phase === "countdown") return "游戏即将开始！";
    if (gameState.phase === "finished") return "游戏结束！";
    if (pendingCardIndex !== -1) return "🌟 请选择一张有色手牌作为连带丢出牌（再次点击已选卡牌取消）";
    if (isMyTurn) {
      if (localSkipCount >= 3) {
        return "⛔ 已跳过3回合，本回合必须出牌或摸牌";
      }
      if (gameState.drawAccumulated > 0) {
        return `💥 惩罚累计中：+${gameState.drawAccumulated}！请出任意+2或+4防守，否则点击牌堆吃惩罚！`;
      }
      if (gameState.minValue !== undefined && gameState.minValue >= 0) {
        return `🔥 拼点中：必须出相同颜色且数字 >= ${gameState.minValue} 的牌！`;
      }
      return "👉 你的回合，请出牌或摸牌";
    }
    
    const currentPlayer = gameState.players.find(p => p.seatIndex === gameState.currentSeat);
    return `等待 ${currentPlayer?.username} 出牌...`;
  };

  return (
    <div className="game-screen">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', maxWidth: '600px', marginBottom: 12, padding: '0 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0 }}>房间码: {code}</h3>
          {gameState.roomType && gameState.roomType !== "public" && (
            <button
              onClick={() => {
                const link = `${window.location.origin}/?join=${code}`;
                navigator.clipboard.writeText(link).then(() => {
                  showNotice("邀请链接已复制！");
                }).catch(() => {
                  showNotice("复制失败，房间码: " + code);
                });
              }}
              style={{
                background: '#4a90d9',
                border: 'none',
                padding: '4px 10px',
                borderRadius: 4,
                color: 'white',
                cursor: 'pointer',
                fontSize: 12,
              }}
              title="复制邀请链接"
            >
              复制邀请链接
            </button>
          )}
        </div>
        <button onClick={() => setShowLeaveConfirm(true)} style={{ background: '#ff4444', border: 'none', padding: '6px 12px', borderRadius: 4, color: 'white', cursor: 'pointer' }}>
          退出房间
        </button>
      </div>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      {notification && (
        <div style={{
          position: "fixed",
          top: 24,
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.8)",
          color: "white",
          padding: "8px 16px",
          borderRadius: 20,
          fontSize: 14,
          fontWeight: "bold",
          zIndex: 1000,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)"
        }}>
          {notification}
        </div>
      )}
      <div className="game-table">
        <div style={{ textAlign: "center", marginBottom: 16, fontSize: 18, fontWeight: "bold", color: isMyTurn ? "var(--uno-red)" : "#666" }}>
          {getGameHint()}
        </div>

        <PlayerList players={gameState.players} currentSeat={gameState.currentSeat} localSeat={localSeat} />

        <div className="center-area">
          <DiscardPile card={gameState.topCard} playHistory={gameState.playHistory} />
          <div 
            className={`deck ${!canDraw ? "disabled" : ""}`} 
            onClick={canDraw ? handleDraw : undefined}
          >
            {gameState.phase === "playing" ? `${gameState.deckCount}张` : ""}
          </div>
        </div>

        {gameState.phase === "playing" && (
          <PlayerHand
            cards={hand}
            onPlayCard={handlePlayCard}
            onSkip={(isMyTurn && !(gameState.drawAccumulated > 0) && localSkipCount < 3) ? handleSkip : undefined}
            disabled={!isMyTurn}
            topCard={gameState.topCard}
            wildColor={gameState.wildColor}
            drawAccumulated={gameState.drawAccumulated}
            minValue={gameState.minValue}
            isSelectingCombo={pendingCardIndex !== -1}
            pendingCardIndex={pendingCardIndex}
          />
        )}

        {gameState.phase === "waiting" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 16 }}>
            <button className={localPlayer?.isReady ? "" : "primary"} onClick={handleReady} style={{ width: 120 }}>
              {localPlayer?.isReady ? "取消准备" : "准备"}
            </button>
            {localPlayer?.isHost && (
              <button onClick={handleStartGame} style={{ width: 120 }}>
                开始游戏
              </button>
            )}
          </div>
        )}

        {gameState.phase === "countdown" && (
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", color: "white", fontSize: 120, fontWeight: "bold", zIndex: 100 }}>
            {countdownText}
          </div>
        )}

        {gameState.phase === "finished" && (
          <div className="finished-box" style={{ position: 'relative', zIndex: 10 }}>
            <h2>
              游戏结束！
              {gameState.winnerSeat === localSeat ? "你赢了！" : `座位 ${(gameState.winnerSeat ?? 0) + 1} 获胜`}
            </h2>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 16 }}>
              <button className="primary" onClick={handleContinue}>继续游戏</button>
              <button onClick={() => setShowLeaveConfirm(true)}>离开房间</button>
            </div>
          </div>
        )}
      </div>
      
      {showLeaveConfirm && (
        <ConfirmModal
          message="确定要退出房间吗？"
          onConfirm={handleLeaveRoom}
          onCancel={() => setShowLeaveConfirm(false)}
        />
      )}
    </div>
  );
}
