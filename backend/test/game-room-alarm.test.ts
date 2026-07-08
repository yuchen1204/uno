import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import type { GameRoomDOv2 } from "../src/game/game-room-do";
import { COUNTDOWN_DURATION_MS } from "../../shared/constants";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

describe("GameRoomDOv2 countdown alarm", () => {
  it("keeps the countdown alarm when countdown state is broadcast", async () => {
    const stub = env.GAME_ROOM_DO.getByName(`countdown-${crypto.randomUUID()}`) as DurableObjectStub<GameRoomDOv2>;

    await stub.joinGame("ABC123", "alice", null);
    await stub.joinGame("ABC123", "bob", null);
    const result = await stub.handleStartGame();

    expect(result.success).toBe(true);

    await runInDurableObject(stub, async (instance, state) => {
      const gameState = state.storage.sql.exec<{ countdown_end: number }>(
        "SELECT countdown_end FROM game_state WHERE id = 1",
      ).one();

      await instance.broadcastState();

      const alarm = await state.storage.getAlarm();
      expect(alarm).not.toBeNull();
      expect(alarm!).toBeLessThanOrEqual(gameState.countdown_end + 250);
      expect(alarm!).toBeGreaterThanOrEqual(gameState.countdown_end - COUNTDOWN_DURATION_MS);
    });
  });
});
