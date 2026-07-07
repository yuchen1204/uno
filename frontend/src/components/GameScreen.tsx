import { useState, useEffect, useCallback, useRef, useReducer } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../AuthContext";
import { api } from "../api";
import { GameState, Card as CardType, CardColor } from "../types";
import PlayerHand from "./PlayerHand";
import { canPlayCard } from "../../../shared/rules";
import DiscardPile from "./DiscardPile";
import PlayerList from "./PlayerList";
import ColorPicker from "./ColorPicker";
import ConfirmModal from "./ConfirmModal";

interface Props {
  code: string;
  onLeave: () => void;
}

interface UiState {
  pendingCardIndex: number;
  countdownText: string;
  notification: string | null;
  error: string;
  showLeaveConfirm: boolean;
  showNicknameModal: boolean;
  tempNickname: string;
  nicknameJoining: boolean;
  showVoidResponse: boolean;
}

type UiAction =
  | { type: "SET_PENDING_CARD"; index: number }
  | { type: "CLEAR_PENDING_CARD" }
  | { type: "SET_COUNTDOWN"; text: string }
  | { type: "SHOW_NOTIFICATION"; msg: string }
  | { type: "HIDE_NOTIFICATION"; msg: string }
  | { type: "SET_ERROR"; error: string }
  | { type: "CLEAR_ERROR" }
  | { type: "SHOW_LEAVE_CONFIRM"; show: boolean }
  | { type: "SHOW_NICKNAME_MODAL"; show: boolean }
  | { type: "SET_TEMP_NICKNAME"; nickname: string }
  | { type: "SHOW_VOID_RESPONSE"; show: boolean };

const initialUi: UiState = {
  pendingCardIndex: -1,
  countdownText: "",
  notification: null,
  error: "",
  showLeaveConfirm: false,
  showNicknameModal: false,
  tempNickname: "",
  nicknameJoining: false,
  showVoidResponse: false,
};

function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "SET_PENDING_CARD": return { ...state, pendingCardIndex: action.index };
    case "CLEAR_PENDING_CARD": return { ...state, pendingCardIndex: -1 };
    case "SET_COUNTDOWN": return { ...state, countdownText: action.text };
    case "SHOW_NOTIFICATION": return { ...state, notification: action.msg };
    case "HIDE_NOTIFICATION": return state.notification === action.msg ? { ...state, notification: null } : state;
    case "SET_ERROR": return { ...state, error: action.error };
    case "CLEAR_ERROR": return { ...state, error: "" };
    case "SHOW_LEAVE_CONFIRM": return { ...state, showLeaveConfirm: action.show };
    case "SHOW_NICKNAME_MODAL": return { ...state, showNicknameModal: action.show };
    case "SET_TEMP_NICKNAME": return { ...state, tempNickname: action.nickname };
    case "SHOW_VOID_RESPONSE": return { ...state, showVoidResponse: action.show };
  }
}

const NOTIFICATION_DURATION = 3000;
const ERROR_DURATION = 2000;

export default function GameScreen({ code, onLeave }: Props) {
  const { user } = useAuth();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [localSeat, setLocalSeatState] = useState<number>(-1);
  const localSeatRef = useRef<number>(-1);
  const setLocalSeat = useCallback((seat: number) => {
    localSeatRef.current = seat;
    setLocalSeatState(seat);
  }, []);
  const [hand, setHand] = useState<CardType[]>([]);
  const [ui, dispatch] = useReducer(uiReducer, initialUi);
  const streamRef = useRef<AbortController | null>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback((msg: string) => {
    dispatch({ type: "SHOW_NOTIFICATION", msg });
    if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
    notifyTimerRef.current = setTimeout(() => {
      dispatch({ type: "HIDE_NOTIFICATION", msg });
    }, NOTIFICATION_DURATION);
  }, []);

  const setError = useCallback((msg: string) => {
    dispatch({ type: "SET_ERROR", error: msg });
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => {
      dispatch({ type: "CLEAR_ERROR" });
    }, ERROR_DURATION);
  }, []);

  const fetchHand = useCallback(async () => {
    const seat = localSeatRef.current;
    if (seat < 0) return;
    try {
      const res = await api.getPlayerHand(code, seat);
      setHand(res.hand);
    } catch (e) { console.error("fetchHand failed for seat", seat, e); }
  }, [code]);

  const joinAndStream = useCallback(async (nicknameOverride?: string) => {
    try {
      let nickname = user?.username || nicknameOverride;

      if (!nickname && !user) {
        try {
          const roomInfo = await api.getRoom(code);
          if (roomInfo.type === "quick") {
            dispatch({ type: "SHOW_NICKNAME_MODAL", show: true });
            return;
          }
        } catch (e) {
          console.error("getRoom failed", e);
        }
      }

      const joinRes = await api.joinRoom(code, nickname);
      setLocalSeat(joinRes.seatIndex);
      dispatch({ type: "SHOW_NICKNAME_MODAL", show: false });

      const state = await api.getGameState(code);
      gameStateRef.current = state;
      setGameState(state);

      try {
        const handRes = await api.getPlayerHand(code, joinRes.seatIndex);
        setHand(handRes.hand);
      } catch (e) { console.error("fetchHand failed after join", e); }

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
              if (parsed.type === "room_closed") {
                setError(parsed.reason || "房间已关闭");
                setTimeout(() => onLeave(), 2000);
                return;
              }
              const newState: GameState = parsed;
              const oldState = gameStateRef.current;
              if (oldState) {
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
                newState.players.forEach(np => {
                  const op = oldState.players.find(p => p.seatIndex === np.seatIndex);
                  if (!op) {
                    showNotice(`${np.username} 加入了房间`);
                  }
                });
              }
              gameStateRef.current = newState;
              setGameState(newState);
            } catch (e) { console.error("Failed to parse stream line", e); }
          }
          fetchHand();
        }
      };
      readLoop().catch((e: unknown) => { console.error("Stream read error:", e); });
    } catch (err: any) {
      setError(err.message || "加入游戏失败");
    }
  }, [code, user, fetchHand, onLeave, showNotice, setError]);

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
          dispatch({ type: "SET_COUNTDOWN", text: Math.ceil(diff / 1000).toString() });
        } else {
          dispatch({ type: "SET_COUNTDOWN", text: "开始！" });
          api.commitStart(code).catch(() => {});
        }
      }, 100);
      return () => clearInterval(interval);
    } else {
      dispatch({ type: "SET_COUNTDOWN", text: "" });
    }
  }, [gameState]);

  useEffect(() => {
    if (gameState?.voidProposalSeat != null && gameState.voidProposalSeat !== localSeat) {
      dispatch({ type: "SHOW_VOID_RESPONSE", show: true });
    } else if (gameState?.voidProposalSeat == null) {
      dispatch({ type: "SHOW_VOID_RESPONSE", show: false });
    }
  }, [gameState?.voidProposalSeat, localSeat]);

  const doAction = async (action: string, cardIndex?: number, color?: CardColor, comboCardIndex?: number) => {
    try {
      const result = await api.playerAction(code, localSeat, action, cardIndex, color, comboCardIndex);
      if (!result.success) {
        setError(result.error || "操作失败");
      }
      await fetchHand();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const doVoidAction = async (action: string, agreed?: boolean) => {
    try {
      const result = await api.playerAction(code, localSeat, action, undefined, undefined, undefined, agreed);
      if (!result.success) {
        setError(result.error || "操作失败");
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handlePlayCard = (index: number) => {
    if (!gameState || gameState.currentSeat !== localSeat) return;
    const card = hand[index];
    if (!card) return;

    if (ui.pendingCardIndex === -1) {
      if (card.type === "wild" || card.type === "wild4") {
        if (hand.length === 1) {
          doAction("play_card", index);
        } else {
          dispatch({ type: "SET_PENDING_CARD", index });
        }
      } else {
        doAction("play_card", index);
      }
    } else {
      if (index === ui.pendingCardIndex) {
        dispatch({ type: "CLEAR_PENDING_CARD" });
        return;
      }
      if (card.type === "wild" || card.type === "wild4") {
        setError("连带丢出的卡牌不能是万能牌！");
        return;
      }
      doAction("play_card", ui.pendingCardIndex, undefined, index);
      dispatch({ type: "CLEAR_PENDING_CARD" });
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
      }
    } catch (err: any) {
      setError(err.message);
    }
  };
  const handleContinue = () => doAction("continue_game");

  const handleLeaveRoom = async () => {
    dispatch({ type: "SHOW_LEAVE_CONFIRM", show: false });
    try {
      await api.leaveRoom(code, user?.username);
      onLeave();
    } catch (err: any) {
      setError(err.message || "退出失败");
    }
  };

  if (ui.error && !gameState && !ui.showNicknameModal) {
    return (
      <div className="game-screen">
        <p className="error">{ui.error}</p>
        <button onClick={onLeave}>返回大厅</button>
      </div>
    );
  }

  if (ui.showNicknameModal) {
    return (
      <div className="game-screen game-screen-centered">
        <div className="modal nickname-modal">
          <h2>加入快速房间</h2>
          <p className="modal-hint">设置一个游戏内显示的昵称</p>
          {ui.error && <p className="error" style={{ color: '#ff4d4f', marginBottom: '10px' }}>{ui.error}</p>}
          <input
            type="text"
            value={ui.tempNickname}
            onChange={e => dispatch({ type: "SET_TEMP_NICKNAME", nickname: e.target.value })}
            placeholder="你的昵称"
          />
          <button onClick={() => {
            if (ui.tempNickname.trim()) {
              joinAndStream(ui.tempNickname.trim());
            }
          }}>进入房间</button>
          <button onClick={onLeave} className="secondary">取消</button>
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
    if (ui.pendingCardIndex !== -1) return "🌟 请选择一张有色手牌作为连带丢出牌（再次点击已选卡牌取消）";
    if (isMyTurn) {
      if (localSkipCount >= 3) return "⛔ 已跳过3回合，本回合必须出牌或摸牌";
      if (gameState.drawAccumulated > 0) return `💥 惩罚累计中：+${gameState.drawAccumulated}！请出任意+2或+4防守，否则点击牌堆吃惩罚！`;
      if (gameState.minValue !== undefined && gameState.minValue >= 0) return `🔥 拼点中：必须出相同颜色且数字 >= ${gameState.minValue} 的牌！`;
      return "👉 你的回合，请出牌或摸牌";
    }
    const currentPlayer = gameState.players.find(p => p.seatIndex === gameState.currentSeat);
    return `等待 ${currentPlayer?.username} 出牌...`;
  };

  return (
    <div className="game-screen">
      <div className="game-header-bar">
        <div className="game-header-left">
          <h3>房间码: {code}</h3>
          {gameState.roomType && gameState.roomType !== "public" && (
            <button className="copy-link-btn" onClick={() => {
              const link = `${window.location.origin}/?join=${code}`;
              navigator.clipboard.writeText(link).then(() => {
                showNotice("邀请链接已复制！");
              }).catch(() => {
                showNotice("复制失败，房间码: " + code);
              });
            }} title="复制邀请链接">
              复制邀请链接
            </button>
          )}
        </div>
        <button className="leave-btn" onClick={() => dispatch({ type: "SHOW_LEAVE_CONFIRM", show: true })}>
          退出房间
        </button>
      </div>

      {ui.error && <div className="error game-error">{ui.error}</div>}

      {ui.notification && (
        <div className="notification-toast">{ui.notification}</div>
      )}

      <div className="game-table">
        <div className={`game-hint ${isMyTurn ? "my-turn" : ""}`}>
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

        {gameState.phase === "playing" && gameState.voidProposalSeat == null && (
          <PlayerHand
            cards={hand}
            onPlayCard={handlePlayCard}
            onSkip={(isMyTurn && !(gameState.drawAccumulated > 0) && localSkipCount < 3) ? handleSkip : undefined}
            disabled={!isMyTurn}
            topCard={gameState.topCard}
            wildColor={gameState.wildColor}
            drawAccumulated={gameState.drawAccumulated}
            minValue={gameState.minValue}
            isSelectingCombo={ui.pendingCardIndex !== -1}
            pendingCardIndex={ui.pendingCardIndex}
          />
        )}

        {gameState.phase === "playing" && gameState.voidProposalSeat == null && (
          <div className="void-proposal-area">
            <button className="void-propose-btn" onClick={() => doVoidAction("void_game")}>
              提议无效局
            </button>
          </div>
        )}

        {gameState.phase === "playing" && gameState.voidProposalSeat === localSeat && (
          <div className="void-waiting">
            <p>⏳ 已提议无效局，等待对方回应...</p>
            <button onClick={() => doVoidAction("cancel_void")}>取消提议</button>
          </div>
        )}

        {gameState.phase === "waiting" && (
          <div className="waiting-actions">
            <button className={localPlayer?.isReady ? "" : "primary"} onClick={handleReady}>
              {localPlayer?.isReady ? "取消准备" : "准备"}
            </button>
            {localPlayer?.isHost && gameState.maxPlayers !== 2 && (
              <button onClick={handleStartGame}>开始游戏</button>
            )}
          </div>
        )}

        {gameState.phase === "countdown" && createPortal(
          <div className="countdown-overlay">
            {ui.countdownText}
          </div>,
          document.body
        )}

        {gameState.phase === "finished" && (
          <div className="finished-box">
            <h2>
              {gameState.voided
                ? "本局为无效局（Void Game），双方不计分"
                : `游戏结束！${gameState.winnerSeat === localSeat ? "你赢了！" : `座位 ${(gameState.winnerSeat ?? 0) + 1} 获胜`}`
              }
            </h2>
            <div className="finished-actions">
              <button className="primary" onClick={handleContinue}>继续游戏</button>
              <button onClick={() => dispatch({ type: "SHOW_LEAVE_CONFIRM", show: true })}>离开房间</button>
            </div>
          </div>
        )}
      </div>

      {ui.showLeaveConfirm && (
        <ConfirmModal
          message="确定要退出房间吗？"
          onConfirm={handleLeaveRoom}
          onCancel={() => dispatch({ type: "SHOW_LEAVE_CONFIRM", show: false })}
        />
      )}

      {ui.showVoidResponse && (
        <ConfirmModal
          message="对方提议此局作废（Void Game），是否同意？"
          confirmText="同意"
          cancelText="拒绝"
          onConfirm={() => {
            dispatch({ type: "SHOW_VOID_RESPONSE", show: false });
            doVoidAction("void_response", true);
          }}
          onCancel={() => {
            dispatch({ type: "SHOW_VOID_RESPONSE", show: false });
            doVoidAction("void_response", false);
          }}
        />
      )}
    </div>
  );
}