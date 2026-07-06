import { DurableObject } from "cloudflare:workers";
import type { Env, PlayerRow, PlayerBasicRow, RoomConfigRow, GameStateRow, PlayHistoryRow } from "../env";
import { Card, CardColor, GameState, PlayerFull } from "../types";
import { createDeck, shuffleDeck, dealCards, cardToScore } from "./deck";
import { canPlayCard } from "./rules";
import { calculateHandScore } from "./scoring";
import {
  COUNTDOWN_DURATION_MS, INITIAL_HAND_SIZE, IDLE_TIMEOUT_MS, DISCONNECT_TIMEOUT_MS,
  IDLE_CHECK_INTERVAL_MS, LAST_CARD_WILD_PENALTY, PLAY_HISTORY_LIMIT, MAX_SKIP_COUNT,
} from "../../../shared/constants";

export class GameRoomDOv2 extends DurableObject<Env> {
  pendingStreams: WritableStream[] = [];
  disconnectTimers: Map<number, number> = new Map();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room_config (
          code TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          max_players INTEGER DEFAULT 4,
          min_players INTEGER DEFAULT 2,
          status TEXT NOT NULL DEFAULT 'waiting',
          last_activity INTEGER DEFAULT 0
        )
      `);
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS players (
          seat_index INTEGER PRIMARY KEY,
          user_id TEXT,
          username TEXT NOT NULL,
          hand TEXT NOT NULL DEFAULT '[]',
          is_host INTEGER DEFAULT 0,
          connected INTEGER DEFAULT 1,
          is_ready INTEGER DEFAULT 0,
          score INTEGER DEFAULT 0,
          skip_count INTEGER DEFAULT 0,
          seat_token TEXT NOT NULL DEFAULT '',
          joined_at TEXT NOT NULL
        )
      `);
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS game_state (
          id INTEGER PRIMARY KEY DEFAULT 1,
          phase TEXT NOT NULL DEFAULT 'waiting',
          current_seat INTEGER,
          direction INTEGER DEFAULT 1,
          top_card TEXT,
          deck TEXT NOT NULL DEFAULT '[]',
          discard_pile TEXT NOT NULL DEFAULT '[]',
          wild_color TEXT,
          draw_accumulated INTEGER DEFAULT 0,
          winner_seat INTEGER,
          countdown_end INTEGER,
          min_value INTEGER DEFAULT -1
        )
      `);
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS play_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          seat_index INTEGER NOT NULL,
          username TEXT NOT NULL,
          card TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          combo_card TEXT
        )
      `);
      ctx.storage.sql.exec(`
        INSERT OR IGNORE INTO game_state (id) VALUES (1)
      `);
    });
  }

  async joinGame(code: string, username: string, userId: string | null, maxPlayers: number = 4, roomType: string = "private"): Promise<{ seatIndex: number; playerCount: number; seatToken?: string }> {
    const existingPlayers = this.ctx.storage.sql.exec<PlayerBasicRow>(
      "SELECT seat_index, user_id, username, is_host FROM players ORDER BY seat_index"
    ).toArray();
    const existingMe = existingPlayers.find((p) => userId ? p.user_id === userId : p.username === username);
    if (existingMe) {
      this.ctx.storage.sql.exec("UPDATE players SET connected = 1 WHERE seat_index = ?", existingMe.seat_index);
      await this.ctx.storage.deleteAlarm();
      this.broadcastState();
      const tokenRow = this.ctx.storage.sql.exec<{ seat_token: string }>(
        "SELECT seat_token FROM players WHERE seat_index = ?", existingMe.seat_index
      ).one();
      return { seatIndex: existingMe.seat_index, playerCount: existingPlayers.length, seatToken: tokenRow?.seat_token };
    }

    const host = existingPlayers.find((p) => p.is_host === 1);
    if (host && host.username === username) {
      throw new Error("昵称不能与房主相同");
    }

    const nameConflict = existingPlayers.find((p) => p.username === username);
    if (nameConflict) throw new Error("昵称已被房间内其他玩家使用");

    const configs = this.ctx.storage.sql.exec<RoomConfigRow>("SELECT * FROM room_config LIMIT 1").toArray();
    let config = configs.length > 0 ? configs[0] : null;
    if (!config) {
      this.ctx.storage.sql.exec(
        "INSERT INTO room_config (code, type, max_players, status) VALUES (?, ?, ?, 'waiting')",
        code, roomType, maxPlayers
      );
      config = { code: code, type: roomType, max_players: maxPlayers, min_players: 2, status: "waiting", last_activity: 0 };
    }
    if (config && config.status !== "waiting" && config.status !== "countdown") throw new Error("房间不可加入");

    const roomMaxPlayers = config!.max_players;
    if (existingPlayers.length >= roomMaxPlayers) throw new Error("房间已满");

    const usedSeats = new Set(existingPlayers.map(p => p.seat_index));
    let seatIndex = 0;
    while (usedSeats.has(seatIndex)) seatIndex++;

    const now = new Date().toISOString();
    const isHost = seatIndex === 0;
    const seatToken = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      "INSERT INTO players (seat_index, user_id, username, hand, is_host, connected, is_ready, seat_token, joined_at) VALUES (?, ?, ?, '[]', ?, 1, 0, ?, ?)",
      seatIndex,
      userId,
      username,
      isHost ? 1 : 0,
      seatToken,
      now,
    );

    this.broadcastState();
    return { seatIndex, playerCount: existingPlayers.length + 1, seatToken };
  }

  async leaveGame(username: string, userId: string | null): Promise<{ success: boolean; error?: string; empty?: boolean; playerCount?: number }> {
    const existingPlayers = this.ctx.storage.sql.exec<PlayerRow>(
      "SELECT seat_index, user_id, username, hand, is_host, connected, score FROM players ORDER BY seat_index"
    ).toArray();
    const me = existingPlayers.find(p => userId ? p.user_id === userId : p.username === username);
    if (!me) return { success: false, error: "玩家不在房间内" };

    const remainingPlayers = existingPlayers.filter(p => p.seat_index !== me.seat_index);
    const gameState = this.getGameState();

    let nextSeat: number | null = null;
    if (gameState?.phase === "playing" && remainingPlayers.length >= 2 && gameState.current_seat === me.seat_index) {
      const fullPlayers: PlayerFull[] = existingPlayers.map(r => ({
        seatIndex: r.seat_index,
        userId: r.user_id,
        username: r.username,
        hand: JSON.parse(r.hand) as Card[],
        isHost: r.is_host === 1,
        connected: r.connected === 1,
        isReady: r.is_ready === 1,
        score: r.score,
        skipCount: r.skip_count ?? 0,
      }));
      nextSeat = this.getNextSeat(me.seat_index, gameState.direction as 1 | -1, fullPlayers);
    }

    this.ctx.storage.sql.exec("DELETE FROM players WHERE seat_index = ?", me.seat_index);

    if (gameState?.phase === "countdown") {
      await this.ctx.storage.deleteAlarm();
      this.ctx.storage.sql.exec("UPDATE game_state SET phase = 'waiting', countdown_end = 0");
      this.ctx.storage.sql.exec("UPDATE room_config SET status = 'waiting'");
    }
    if (remainingPlayers.length === 0) {
      this.ctx.storage.sql.exec("DELETE FROM room_config");
      this.ctx.storage.sql.exec("DELETE FROM game_state");
      return { success: true, empty: true };
    }

    if (gameState?.phase === "playing" && remainingPlayers.length === 1) {
      const winner = remainingPlayers[0];
      const allPlayersForScore: PlayerFull[] = existingPlayers.map(r => ({
        seatIndex: r.seat_index,
        userId: r.user_id,
        username: r.username,
        hand: JSON.parse(r.hand) as Card[],
        isHost: r.is_host === 1,
        connected: r.connected === 1,
        isReady: r.is_ready === 1,
        score: r.score,
        skipCount: r.skip_count ?? 0,
      }));
      await this.finishGame(winner.seat_index, allPlayersForScore, 0, 0);
    }

    if (me.is_host === 1) {
      const newHost = remainingPlayers[0];
      this.ctx.storage.sql.exec("UPDATE players SET is_host = 1 WHERE seat_index = ?", newHost.seat_index);
    }

    if (nextSeat !== null) {
      this.ctx.storage.sql.exec("UPDATE game_state SET current_seat = ?, min_value = -1, draw_accumulated = 0 WHERE id = 1", nextSeat);
    }

    this.broadcastState();
    return { success: true, empty: false, playerCount: remainingPlayers.length };
  }

  async handleStartGame(): Promise<{ success: boolean; error?: string }> {
    const gameState = this.getGameState();
    if (gameState?.phase !== "waiting") return { success: false, error: "当前不能开始" };

    const players = this.getAllPlayers();
    if (players.length < 2) return { success: false, error: "玩家人数不足" };

    this.ctx.storage.sql.exec("UPDATE game_state SET phase = 'countdown', countdown_end = ?", Date.now() + COUNTDOWN_DURATION_MS);
    this.ctx.storage.sql.exec("UPDATE room_config SET status = 'countdown'");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS _alarm_tag (id INTEGER PRIMARY KEY DEFAULT 1, value INTEGER)");
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO _alarm_tag (id, value) VALUES (1, 1)");
    this.ctx.storage.setAlarm(Date.now() + COUNTDOWN_DURATION_MS).catch(console.error);
    this.broadcastState();
    return { success: true };
  }

  async actualStartGame(): Promise<{ success: boolean; error?: string }> {
    const config = this.ctx.storage.sql.exec<RoomConfigRow>("SELECT * FROM room_config").one();
    if (!config) return { success: false, error: "房间未初始化" };

    const gameState = this.getGameState();
    if (gameState?.phase !== "countdown") return { success: false, error: "不在倒数阶段" };

    const players = this.ctx.storage.sql.exec<PlayerRow>(
      "SELECT * FROM players ORDER BY seat_index"
    ).toArray();
    if (players.length < 2) {
      this.ctx.storage.sql.exec("UPDATE game_state SET phase = 'waiting', countdown_end = 0");
      this.broadcastState();
      return { success: false, error: "玩家人数不足" };
    }

    this.ctx.storage.sql.exec("DELETE FROM play_history");

    let deck = shuffleDeck(createDeck());

    for (const player of players) {
      const { cards, remaining } = dealCards(deck, INITIAL_HAND_SIZE);
      deck = remaining;
      this.ctx.storage.sql.exec(
        "UPDATE players SET hand = ? WHERE seat_index = ?",
        JSON.stringify(cards),
        player.seat_index,
      );
    }

    let topCard: Card;
    do {
      topCard = deck[0];
      deck = deck.slice(1);
    } while (topCard.type === "wild4");

    let wildColor: CardColor | undefined;
    if (topCard.type === "wild") {
      wildColor = (["red", "yellow", "blue", "green"] as CardColor[])[Math.floor(Math.random() * 4)];
    }

    this.ctx.storage.sql.exec(
      "UPDATE game_state SET phase = 'playing', current_seat = 0, direction = 1, top_card = ?, deck = ?, discard_pile = '[]', wild_color = ?, draw_accumulated = 0, min_value = -1 WHERE id = 1",
      JSON.stringify(topCard),
      JSON.stringify(deck),
      wildColor || null,
    );

    this.ctx.storage.sql.exec("UPDATE room_config SET status = 'playing'");
    await this.updateD1RoomStatus(config.code, "playing");

    if (config.type === "public") {
      const lobbyId = this.env.LOBBY_DO.idFromName("global_v2");
      const lobbyStub = this.env.LOBBY_DO.get(lobbyId) as any;
      await lobbyStub.removeRoom(config.code);
    }

    this.broadcastState();
    return { success: true };
  }

  async playerAction(seatIndex: number, action: string, payload?: { cardIndex?: number; color?: CardColor; comboCardIndex?: number }, verify: { username?: string; userId?: string; seatToken?: string } = {}): Promise<{ success: boolean; error?: string; scoreChange?: number; targetSeat?: number }> {
    const players = this.getAllPlayers();
    const player = players.find(p => p.seatIndex === seatIndex);
    if (!player) return { success: false, error: "玩家不存在" };
    const seatOwnerId = verify.userId || null;
    const seatOwnerName = verify.username || null;
    if (seatOwnerId && player.userId && seatOwnerId !== player.userId) {
      return { success: false, error: "不是你的座位" };
    }
    if (seatOwnerName && seatOwnerName !== player.username) {
      return { success: false, error: "不是你的座位" };
    }

    // Quick room seat token verification
    const config = this.ctx.storage.sql.exec<RoomConfigRow>("SELECT code, type FROM room_config LIMIT 1").one();
    if (config?.type === "quick") {
      const tokenRow = this.ctx.storage.sql.exec<{ seat_token: string }>(
        "SELECT seat_token FROM players WHERE seat_index = ?", seatIndex
      ).one();
      if (!verify.seatToken || !tokenRow || tokenRow.seat_token !== verify.seatToken) {
        return { success: false, error: "座位验证失败" };
      }
    }

    if (action === "toggle_ready") {
      return this.toggleReady(seatIndex);
    }
    if (action === "continue_game") {
      return this.continueGame(seatIndex);
    }

    const gameState = this.getGameState();
    if (!gameState || gameState.phase !== "playing") {
      return { success: false, error: "游戏未进行中" };
    }
    if (gameState.current_seat !== seatIndex) {
      return { success: false, error: "不是你的回合" };
    }

    if (action === "draw_card") {
      const res = this.handleDrawCard(player, players, gameState);
      if (res.success) {
        this.ctx.storage.sql.exec("UPDATE players SET skip_count = 0 WHERE seat_index = ?", player.seatIndex);
        this.broadcastState();
      }
      return res;
    } else if (action === "skip_turn") {
      return this.handleSkipTurn(player, players, gameState);
    } else if (action === "play_card") {
      const res = this.handlePlayCard(player, players, gameState, (payload || {}));
      if (res.success) {
        this.ctx.storage.sql.exec("UPDATE players SET skip_count = 0 WHERE seat_index = ?", player.seatIndex);
        this.broadcastState();
      }
      return res;
    } else if (action === "say_uno") {
      return { success: true };
    }
    return { success: false, error: "无效操作" };
  }

  private async toggleReady(seatIndex: number): Promise<{ success: boolean; error?: string }> {
    const gameState = this.getGameState();
    if (gameState?.phase !== "waiting") return { success: false, error: "当前不能准备" };

    const players = this.getAllPlayers();
    const me = players.find(p => p.seatIndex === seatIndex);
    if (!me) return { success: false, error: "玩家不存在" };

    const newReadyState = me.isReady ? 0 : 1;
    this.ctx.storage.sql.exec("UPDATE players SET is_ready = ? WHERE seat_index = ?", newReadyState, seatIndex);
    
    const updatedPlayers = this.getAllPlayers();
    const connectedPlayers = updatedPlayers.filter(p => p.connected);
    const allReady = connectedPlayers.every(p => p.isReady);
    const config = this.ctx.storage.sql.exec<{ max_players: number }>("SELECT max_players FROM room_config LIMIT 1").one();
    const maxPlayers = config?.max_players ?? 4;
    const isFull = connectedPlayers.length >= maxPlayers;
    
    if (allReady && connectedPlayers.length >= 2) {
      this.ctx.storage.sql.exec("UPDATE game_state SET phase = 'countdown', countdown_end = ?", Date.now() + COUNTDOWN_DURATION_MS);
      this.ctx.storage.sql.exec("UPDATE room_config SET status = 'countdown'");
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS _alarm_tag (id INTEGER PRIMARY KEY DEFAULT 1, value INTEGER)");
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO _alarm_tag (id, value) VALUES (1, 1)");
      await this.ctx.storage.setAlarm(Date.now() + COUNTDOWN_DURATION_MS);
    }

    this.broadcastState();
    return { success: true };
  }

  private async continueGame(seatIndex: number): Promise<{ success: boolean; error?: string }> {
    const gameState = this.getGameState();
    if (gameState?.phase !== "finished") return { success: false, error: "游戏未结束" };

    this.ctx.storage.sql.exec("UPDATE game_state SET phase = 'waiting', deck = '[]', discard_pile = '[]', top_card = NULL, wild_color = NULL, current_seat = NULL, winner_seat = NULL, draw_accumulated = 0, countdown_end = 0, min_value = -1");
    this.ctx.storage.sql.exec("UPDATE room_config SET status = 'waiting'");
    this.ctx.storage.sql.exec("UPDATE players SET is_ready = 0, hand = '[]', skip_count = 0");
    this.ctx.storage.sql.exec("UPDATE players SET is_ready = 1 WHERE seat_index = ?", seatIndex);
    
    this.broadcastState();
    return { success: true };
  }

  private handleDrawCard(player: PlayerFull, players: PlayerFull[], state: GameStateRow): { success: boolean; error?: string; scoreChange?: number } {
    let deck = JSON.parse(state.deck) as Card[];
    const wildColor = state.wild_color ? (state.wild_color as CardColor) : undefined;
    const topCard = JSON.parse(state.top_card || "{}") as Card;

    if (state.draw_accumulated > 0) {
      let drawCount = state.draw_accumulated;
      let drawn: Card[] = [];
      while (drawCount > 0) {
        if (deck.length === 0) {
          const reshuffled = this.reshuffleDiscard(deck, state);
          if (reshuffled) {
            deck = reshuffled;
          } else {
            break;
          }
        }
        const take = Math.min(drawCount, deck.length);
        drawn.push(...deck.slice(0, take));
        deck = deck.slice(take);
        drawCount -= take;
      }
      const newHand = [...player.hand, ...drawn];
      this.updatePlayerHand(player.seatIndex, newHand);
      this.updateDeck(deck);

      this.ctx.storage.sql.exec("UPDATE game_state SET draw_accumulated = 0, min_value = -1 WHERE id = 1");
      this.broadcastState();
      return { success: true };
    }

    const hasMatchingNormal = player.hand.some(c => 
      c.type !== "wild" && 
      c.type !== "wild4" && 
      canPlayCard(c, topCard, player.hand, wildColor, 0, state.min_value)
    );
    if (hasMatchingNormal) {
      return { success: false, error: "你手牌里有相同颜色或数字的牌，必须出牌" };
    }

    if (deck.length === 0) {
      const reshuffled = this.reshuffleDiscard(deck, state);
      if (reshuffled) {
        deck = reshuffled;
      } else {
        this.ctx.storage.sql.exec("UPDATE game_state SET min_value = -1 WHERE id = 1");
        const updatedState = { ...state, min_value: -1 };
        this.advanceToNext(updatedState, players);
        this.broadcastState();
        return { success: true };
      }
    }

    const drawnCard = deck[0];
    const newDeck = deck.slice(1);
    const newHand = [...player.hand, drawnCard];

    this.updatePlayerHand(player.seatIndex, newHand);
    this.updateDeck(newDeck);
    
    this.ctx.storage.sql.exec("UPDATE game_state SET min_value = -1 WHERE id = 1");

    this.broadcastState();
    return { success: true };
  }

  private handleSkipTurn(player: PlayerFull, players: PlayerFull[], state: GameStateRow): { success: boolean; error?: string; scoreChange?: number } {
    if (state.draw_accumulated > 0) {
      return { success: false, error: "惩罚状态下不能跳过" };
    }

    const skipCount = player.skipCount ?? 0;
    if (skipCount >= MAX_SKIP_COUNT) {
      return { success: false, error: "已跳过3次，必须出牌或摸牌" };
    }

    this.ctx.storage.sql.exec("UPDATE players SET skip_count = skip_count + 1 WHERE seat_index = ?", player.seatIndex);
    this.ctx.storage.sql.exec("UPDATE game_state SET min_value = -1, draw_accumulated = 0 WHERE id = 1");
    const updatedState = { ...state, min_value: -1, draw_accumulated: 0 };
    this.advanceToNext(updatedState, players);
    this.broadcastState();
    return { success: true };
  }

  handlePlayCard(
    player: PlayerFull,
    players: PlayerFull[],
    state: GameStateRow,
    payload: { cardIndex?: number; color?: CardColor; comboCardIndex?: number } = {}
  ): { success: boolean; error?: string; scoreChange?: number; targetSeat?: number } {
    const cardIndex = payload.cardIndex ?? -1;
    const card = player.hand[cardIndex];
    if (!card) return { success: false, error: "无效的牌" };

    const wildColor = state.wild_color ? (state.wild_color as CardColor) : undefined;
    const topCard = JSON.parse(state.top_card || "{}") as Card;

    if (!canPlayCard(card, topCard, player.hand, wildColor, state.draw_accumulated, state.min_value)) {
      return { success: false, error: "不能出这张牌" };
    }

    if (card.type === "wild" || card.type === "wild4") {
      if (player.hand.length === 1) {
        const deck = JSON.parse(state.deck) as Card[];
        const count = Math.min(LAST_CARD_WILD_PENALTY, deck.length);
        const drawn = deck.slice(0, count);
        const newDeck = deck.slice(count);
        const newHand = player.hand.filter((_, i) => i !== cardIndex).concat(drawn);
        this.updatePlayerHand(player.seatIndex, newHand);
        this.updateDeck(newDeck);

        const discardPile = JSON.parse(state.discard_pile) as Card[];
        discardPile.push(topCard);

        const nextSeat = this.getNextSeat(player.seatIndex, state.direction as 1 | -1, players);
        this.ctx.storage.sql.exec(
          "UPDATE game_state SET current_seat = ?, top_card = ?, deck = ?, discard_pile = ?, wild_color = ?, min_value = -1 WHERE id = 1",
          nextSeat,
          JSON.stringify(card),
          JSON.stringify(newDeck),
          JSON.stringify(discardPile),
          payload.color || "red"
        );

        this.broadcastState();
        return { success: true };
      }

      if (payload.comboCardIndex === undefined) {
        return { success: false, error: "请选择一张有色牌一起出！" };
      }
      if (payload.comboCardIndex === cardIndex) {
        return { success: false, error: "不能选择自身作为连携牌！" };
      }
      const comboCard = player.hand[payload.comboCardIndex];
      if (!comboCard || comboCard.type === "wild" || comboCard.type === "wild4") {
        return { success: false, error: "伴随丢出的牌必须是有色牌！" };
      }

      if (state.draw_accumulated > 0) {
        if (card.type === "wild4") {
        } else if (card.type === "wild" && comboCard.type === "draw2") {
        } else {
          return { success: false, error: "防守状态下，连携牌必须是+2以防御惩罚！" };
        }
      }

      const newHand = player.hand.filter((_, i) => i !== cardIndex && i !== payload.comboCardIndex);
      this.updatePlayerHand(player.seatIndex, newHand);

      const deck = JSON.parse(state.deck) as Card[];
      const discardPile = JSON.parse(state.discard_pile) as Card[];
      discardPile.push(card);

      const nextSeat = this.getNextSeat(player.seatIndex, state.direction as 1 | -1, players);
      let addedPenalty = card.type === "wild4" ? 4 : 0;
      if (comboCard.type === "draw2") addedPenalty += 2;

      const newDrawAccumulated = state.draw_accumulated + addedPenalty;
      const newMinValue = comboCard.value !== undefined ? comboCard.value : -1;

      this.ctx.storage.sql.exec(
        "INSERT INTO play_history (seat_index, username, card, timestamp, combo_card) VALUES (?, ?, ?, ?, ?)",
        player.seatIndex,
        player.username,
        JSON.stringify(comboCard),
        Date.now(),
        JSON.stringify(card)
      );

      this.ctx.storage.sql.exec(
        "UPDATE game_state SET current_seat = ?, top_card = ?, deck = ?, discard_pile = ?, wild_color = ?, draw_accumulated = ?, min_value = ? WHERE id = 1",
        nextSeat,
        JSON.stringify(comboCard),
        JSON.stringify(deck),
        JSON.stringify(discardPile),
        comboCard.color,
        newDrawAccumulated,
        newMinValue
      );

      if (newHand.length === 0) {
        this.finishGame(player.seatIndex, players, cardToScore(comboCard), 50);
        return { success: true };
      }

      this.broadcastState();
      return { success: true };
    }

    return this.executePlayCard(player, players, state, card, {
      seatIndex: player.seatIndex,
      hand: player.hand,
      deck: JSON.parse(state.deck),
      topCard,
      wildColor,
      cardIndex: cardIndex
    });
  }

  private executePlayCard(
    player: PlayerFull, players: PlayerFull[], state: GameStateRow, card: Card,
    ctxData: { seatIndex: number; hand: Card[]; deck: Card[]; topCard: Card; wildColor?: CardColor; cardIndex: number }
  ): { success: boolean; error?: string; scoreChange?: number; targetSeat?: number } {
    const filteredHand = ctxData.hand.filter((_, i) => i !== ctxData.cardIndex);
    this.updatePlayerHand(player.seatIndex, filteredHand);

    let newDeck = ctxData.deck;
    const discardPile = JSON.parse(state.discard_pile) as Card[];
    discardPile.push(ctxData.topCard);

    let nextSeat = this.getNextSeat(ctxData.seatIndex, state.direction as 1 | -1, players);
    let newDirection = state.direction;
    let scoreChange = 0;
    let targetSeat: number | undefined;
    let wildColor: CardColor | undefined = undefined;
    let skipAfter = false;

    let addedPenalty = 0;
    let newMinValue = card.value !== undefined ? card.value : -1;

    if (card.type === "skip") {
      targetSeat = nextSeat;
      scoreChange = 20;
      skipAfter = true;
    } else if (card.type === "reverse") {
      newDirection = (state.direction * -1) as 1 | -1;
      if (players.length === 2) {
        targetSeat = nextSeat;
        scoreChange = 20;
        skipAfter = true;
      } else {
        nextSeat = this.getNextSeat(ctxData.seatIndex, newDirection as 1 | -1, players);
      }
    } else if (card.type === "draw2") {
      addedPenalty = 2;
    }

    const updatedCurrentSeat = skipAfter ? this.getNextSeat(nextSeat, newDirection as 1 | -1, players) : nextSeat;
    const newDrawAccumulated = state.draw_accumulated + addedPenalty;

    this.ctx.storage.sql.exec(
      "INSERT INTO play_history (seat_index, username, card, timestamp) VALUES (?, ?, ?, ?)",
      player.seatIndex,
      player.username,
      JSON.stringify(card),
      Date.now()
    );

    this.ctx.storage.sql.exec(
      "UPDATE game_state SET phase = 'playing', current_seat = ?, direction = ?, top_card = ?, deck = ?, discard_pile = ?, wild_color = ?, draw_accumulated = ?, min_value = ? WHERE id = 1",
      updatedCurrentSeat,
      newDirection,
      JSON.stringify(card),
      JSON.stringify(newDeck),
      JSON.stringify(discardPile),
      wildColor || null,
      newDrawAccumulated,
      newMinValue,
    );

    if (filteredHand.length === 0) {
      this.finishGame(player.seatIndex, players, cardToScore(card), scoreChange);
      return { success: true, scoreChange, targetSeat };
    }

    if (targetSeat !== undefined && scoreChange > 0) {
      this.addScoreToTarget(targetSeat, scoreChange, players);
    }

    this.broadcastState();
    return { success: true, scoreChange, targetSeat };
  }

  private getNextSeat(current: number, direction: 1 | -1, players: PlayerFull[]): number {
    const seats = players.map(p => p.seatIndex).sort((a, b) => a - b);
    const idx = seats.indexOf(current);
    if (idx === -1) return seats[0];
    const nextIdx = (idx + direction + seats.length) % seats.length;
    return seats[nextIdx];
  }

  private drawCards(seatIndex: number, count: number): void {
    const player = this.getAllPlayers().find(p => p.seatIndex === seatIndex);
    if (!player) return;
    const gameState = this.getGameState();
    if (!gameState) return;
    const deck = JSON.parse(gameState.deck) as Card[];
    const drawn = deck.slice(0, count);
    const newDeck = deck.slice(count);
    const newHand = [...player.hand, ...drawn];
    this.updatePlayerHand(seatIndex, newHand);
    this.updateDeck(newDeck);
  }

  private async finishGame(winnerSeat: number, players: PlayerFull[], finalCardScore: number, actionScore: number): Promise<void> {
    let totalScore = finalCardScore + actionScore;
    for (const p of players) {
      if (p.seatIndex !== winnerSeat) {
        totalScore += calculateHandScore(p.hand);
      }
    }

    this.ctx.storage.sql.exec(
      "UPDATE game_state SET phase = 'finished', winner_seat = ? WHERE id = 1",
      winnerSeat,
    );
    this.ctx.storage.sql.exec("UPDATE room_config SET status = 'finished'");

    const config = this.ctx.storage.sql.exec<{ code: string; type: string }>("SELECT code, type FROM room_config").one();
    if (config && config.type !== "quick" && this.env) {
      const winner = players.find(p => p.seatIndex === winnerSeat);
      if (winner?.userId) {
        try {
          await this.env.DB.prepare("UPDATE users SET score = score + ? WHERE id = ?")
            .bind(totalScore, winner.userId)
            .run();
        } catch (e) { console.error("finishGame: failed to update winner score for user", winner.userId, e); }
      }
    }

    await this.updateD1RoomStatus(config?.code || "", "finished");
    this.broadcastState();
  }

  private addScoreToTarget(seatIndex: number, amount: number, players: PlayerFull[]): void {
    const player = players.find(p => p.seatIndex === seatIndex);
    if (player?.userId && this.env) {
      this.env.DB.prepare("UPDATE users SET score = score + ? WHERE id = ?")
        .bind(amount, player.userId)
        .run()
        .catch((e: unknown) => { console.error("addScoreToTarget: failed to update score for user", player.userId, e); });
    }
  }

  private async updateD1RoomStatus(code: string, status: string): Promise<void> {
    if (this.env && code) {
      this.env.DB.prepare("UPDATE rooms SET status = ? WHERE code = ?")
        .bind(status, code)
        .run()
        .catch((e: unknown) => { console.error("updateD1RoomStatus: failed for code", code, e); });
    }
  }

  private getGameState(): GameStateRow | null {
    const row = this.ctx.storage.sql.exec<GameStateRow>("SELECT * FROM game_state WHERE id = 1").one();
    return row;
  }

  private getAllPlayers(): PlayerFull[] {
    const rows = this.ctx.storage.sql.exec<PlayerRow>("SELECT * FROM players ORDER BY seat_index").toArray();
    return rows.map(r => ({
      seatIndex: r.seat_index,
      userId: r.user_id,
      username: r.username,
      hand: JSON.parse(r.hand) as Card[],
      isHost: r.is_host === 1,
      connected: r.connected === 1,
      isReady: r.is_ready === 1,
      score: r.score,
      skipCount: r.skip_count ?? 0,
    }));
  }

  private updatePlayerHand(seatIndex: number, hand: Card[]): void {
    this.ctx.storage.sql.exec(
      "UPDATE players SET hand = ? WHERE seat_index = ?",
      JSON.stringify(hand),
      seatIndex,
    );
  }

  private updateDeck(deck: Card[]): void {
    this.ctx.storage.sql.exec(
      "UPDATE game_state SET deck = ? WHERE id = 1",
      JSON.stringify(deck),
    );
  }

  private reshuffleDiscard(deck: Card[], state: GameStateRow): Card[] | null {
    const discardPile = JSON.parse(state.discard_pile) as Card[];
    if (discardPile.length < 2) return null;
    const topDiscard = discardPile[discardPile.length - 1];
    const reshuffleCards = discardPile.slice(0, -1);
    const newDeck = shuffleDeck(reshuffleCards);
    this.ctx.storage.sql.exec(
      "UPDATE game_state SET deck = ?, discard_pile = ? WHERE id = 1",
      JSON.stringify(newDeck),
      JSON.stringify([topDiscard])
    );
    return newDeck;
  }

  private advanceToNext(state: GameStateRow, players: PlayerFull[]): void {
    const nextSeat = this.getNextSeat(state.current_seat!, state.direction as 1 | -1, players);
    this.ctx.storage.sql.exec(
      "UPDATE game_state SET current_seat = ? WHERE id = 1",
      nextSeat,
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname.endsWith("/stream")) {
      let userId: string | null = null;
      let username: string | null = null;
      const authHeader = request.headers.get("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        const sessionRaw = await this.env.SESSIONS.get(`session:${token}`);
        if (sessionRaw) {
          const session = JSON.parse(sessionRaw);
          userId = session.userId;
          username = session.username;
        } else {
          const quickSession = await this.env.SESSIONS.get(`quick:${token}`);
          if (quickSession) {
            username = JSON.parse(quickSession).nickname;
          }
        }
      }

      const { readable, writable } = new TransformStream<Uint8Array>();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      const state = await this.getFullStateForPlayer(-1);
      writer.write(encoder.encode(JSON.stringify(state) + "\n"));
      writer.releaseLock();

      this.pendingStreams.push(writable);
      request.signal.onabort = () => {
        const idx = this.pendingStreams.indexOf(writable);
        if (idx >= 0) this.pendingStreams.splice(idx, 1);
        if (username || userId) {
          this.markPlayerOffline(username, userId);
        }
      };

      return new Response(readable, {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  }

  private async markPlayerOffline(username: string | null, userId: string | null) {
    const existingPlayers = this.ctx.storage.sql.exec<PlayerBasicRow>(
      "SELECT seat_index, user_id, username FROM players"
    ).toArray();
    const me = existingPlayers.find(p => userId ? p.user_id === userId : p.username === username);
    if (me) {
      this.ctx.storage.sql.exec("UPDATE players SET connected = 0 WHERE seat_index = ?", me.seat_index);
      
      const updatedPlayers = this.getAllPlayers();
      const activePlayers = updatedPlayers.filter(p => p.connected);
      const gameState = this.getGameState();
      if (activePlayers.length === 0) {
        await this.ctx.storage.setAlarm(Date.now() + DISCONNECT_TIMEOUT_MS);
      } else if (activePlayers.length === 1 && gameState?.phase !== "finished") {
        await this.ctx.storage.setAlarm(Date.now() + DISCONNECT_TIMEOUT_MS);
      }
      await this.broadcastState();
    }
  }

  async alarm() {
    // Check if this is a start game alarm
    const alarmTag = this.ctx.storage.sql.exec<{ value: number }>("SELECT value FROM _alarm_tag WHERE id = 1").one();
    if (alarmTag?.value === 1) {
      this.ctx.storage.sql.exec("DELETE FROM _alarm_tag");
      await this.actualStartGame();
      return;
    }

    const players = this.getAllPlayers();
    const activePlayers = players.filter(p => p.connected);
    const gameState = this.getGameState();

    const configRow = this.ctx.storage.sql.exec<RoomConfigRow>("SELECT code, type, last_activity FROM room_config LIMIT 1").one();
    const lastActivity = configRow?.last_activity ?? 0;
    const elapsed = Date.now() - lastActivity;
    const IDLE_TIMEOUT = IDLE_TIMEOUT_MS;

    if (lastActivity > 0 && elapsed >= IDLE_TIMEOUT) {
      this.ctx.storage.sql.exec("UPDATE players SET score = 0, is_ready = 0");
      const closeMsg = JSON.stringify({ type: "room_closed", reason: "房间闲置超时，已关闭" }) + "\n";
      const encoder = new TextEncoder();
      const closeData = encoder.encode(closeMsg);
      for (let i = 0; i < this.pendingStreams.length; i++) {
        try {
          const writer = this.pendingStreams[i].getWriter();
          writer.write(closeData);
          writer.releaseLock();
        } catch (e) { console.error("alarm: failed to write close message to stream", e); }
      }
      this.pendingStreams = [];
      if (configRow) {
        await this.updateD1RoomStatus(configRow.code, "finished");
        if (configRow.type === "public") {
          try {
            const lobbyId = this.env.LOBBY_DO.idFromName("global_v2");
            const lobbyStub = this.env.LOBBY_DO.get(lobbyId) as any;
            await lobbyStub.removeRoom(configRow.code);
          } catch (e) { console.error("alarm: failed to remove public room", configRow.code, e); }
        }
      }
      this.ctx.storage.sql.exec("DELETE FROM players");
      this.ctx.storage.sql.exec("DELETE FROM room_config");
      this.ctx.storage.sql.exec("DELETE FROM game_state");
      this.ctx.storage.sql.exec("DELETE FROM play_history");
      return;
    }

    if (activePlayers.length === 0) {
      if (configRow) {
        const config = configRow;
        await this.updateD1RoomStatus(config.code, "finished");
        if (config.type === "public") {
          const lobbyId = this.env.LOBBY_DO.idFromName("global_v2");
          const lobbyStub = this.env.LOBBY_DO.get(lobbyId) as any;
          await lobbyStub.removeRoom(config.code);
        }
      }
      this.ctx.storage.sql.exec("DELETE FROM players");
      this.ctx.storage.sql.exec("DELETE FROM room_config");
      this.ctx.storage.sql.exec("DELETE FROM game_state");
    } else if (activePlayers.length === 1 && gameState?.phase !== "finished") {
      if (gameState?.phase === "playing") {
        const winner = activePlayers[0];
        await this.finishGame(winner.seatIndex, players, 0, 0);
      } else {
        if (configRow) {
          const config = configRow;
          await this.updateD1RoomStatus(config.code, "finished");
          if (config.type === "public") {
            const lobbyId = this.env.LOBBY_DO.idFromName("global_v2");
            const lobbyStub = this.env.LOBBY_DO.get(lobbyId) as any;
            await lobbyStub.removeRoom(config.code);
          }
        }
        this.ctx.storage.sql.exec("DELETE FROM players");
        this.ctx.storage.sql.exec("DELETE FROM room_config");
        this.ctx.storage.sql.exec("DELETE FROM game_state");
      }
    } else {
      await this.ensureIdleAlarm(true);
    }
  }

  async getFullStateForPlayer(seatIndex: number): Promise<GameState> {
    const gameState = this.getGameState();
    const players = this.getAllPlayers();
    const topCard = gameState ? JSON.parse(gameState.top_card || "{}") : {};
    const deck = gameState ? JSON.parse(gameState.deck) : [];

    const configRow = this.ctx.storage.sql.exec<{ type: string, max_players: number }>("SELECT type, max_players FROM room_config LIMIT 1").one();

    const historyRows = this.ctx.storage.sql.exec<PlayHistoryRow>(
      "SELECT seat_index, username, card, timestamp, combo_card FROM play_history ORDER BY id DESC LIMIT " + PLAY_HISTORY_LIMIT
    ).toArray();
    const playHistory = historyRows.reverse().map(r => ({
      seatIndex: r.seat_index,
      username: r.username,
      card: JSON.parse(r.card),
      timestamp: r.timestamp,
      comboCard: r.combo_card ? JSON.parse(r.combo_card) : undefined,
    }));

    return {
      phase: (gameState?.phase as GameState["phase"]) || "waiting",
      currentSeat: gameState?.current_seat ?? undefined as unknown as number,
      direction: (gameState?.direction ?? 1) as 1 | -1,
      topCard: topCard as Card,
      deckCount: deck.length,
      wildColor: (gameState?.wild_color ?? undefined) as CardColor | undefined,
      drawAccumulated: gameState?.draw_accumulated ?? 0,
      winnerSeat: gameState?.winner_seat ?? undefined as unknown as number | undefined,
      countdownEnd: gameState?.countdown_end ?? undefined as unknown as number | undefined,
      minValue: gameState?.min_value !== undefined ? gameState.min_value : -1,
      roomType: (configRow?.type as "public" | "private" | "quick" | undefined) || undefined,
      maxPlayers: configRow?.max_players,
      players: players.map(p => ({
        seatIndex: p.seatIndex,
        username: p.username,
        handCount: p.hand.length,
        isHost: p.isHost,
        connected: p.connected,
        isReady: p.isReady,
        score: p.score,
        skipCount: p.skipCount,
      })),
      playHistory,
    };
  }

  async getPlayerHand(seatIndex: number): Promise<{ hand: Card[] }> {
    const player = this.getAllPlayers().find(p => p.seatIndex === seatIndex);
    if (!player) throw new Error("玩家不存在");
    return { hand: player.hand };
  }

  private touchActivity(): void {
    this.ctx.storage.sql.exec("UPDATE room_config SET last_activity = ?", Date.now());
  }

  private async ensureIdleAlarm(force: boolean = false): Promise<void> {
    const existing = this.ctx.storage.sql.exec<{ last_activity: number }>("SELECT last_activity FROM room_config LIMIT 1").one();
    const lastActivity = existing?.last_activity ?? 0;
    const elapsed = Date.now() - lastActivity;
    const checkInterval = IDLE_CHECK_INTERVAL_MS;
    if (force || lastActivity === 0 || elapsed < checkInterval) {
      await this.ctx.storage.setAlarm(Date.now() + checkInterval);
    }
  }

  async broadcastState(): Promise<void> {
    this.touchActivity();
    await this.ensureIdleAlarm();
    if (this.pendingStreams.length === 0) return;
    const state = await this.getFullStateForPlayer(-1);
    const data = JSON.stringify(state) + "\n";
    const encoder = new TextEncoder();
    const message = encoder.encode(data);
    const closedIndexes: number[] = [];
    for (let i = 0; i < this.pendingStreams.length; i++) {
      try {
        const writer = this.pendingStreams[i].getWriter();
        writer.write(message);
        writer.releaseLock();
      } catch (e) {
        closedIndexes.push(i);
      }
    }
    for (const i of closedIndexes.reverse()) {
      this.pendingStreams.splice(i, 1);
    }
  }
}