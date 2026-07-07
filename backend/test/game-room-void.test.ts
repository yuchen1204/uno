import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import type { GameRoomDOv2 } from "../src/game/game-room-do";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

function makeCode(): string {
  return "VOID" + Math.random().toString(36).slice(2, 6).toUpperCase();
}

async function startGame(stub: DurableObjectStub<GameRoomDOv2>, code: string) {
  await stub.joinGame(code, "alice", null);
  await stub.joinGame(code, "bob", null);
  await stub.handleStartGame();
  // Fast-forward past the countdown so handleCommitStart succeeds
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec("UPDATE game_state SET countdown_end = 0 WHERE id = 1");
  });
  await stub.handleCommitStart();
}

describe("Void Game", () => {
  it("allows a player to propose void game during playing phase", async () => {
    const code = makeCode();
    const stub = env.GAME_ROOM_DO.getByName(code) as DurableObjectStub<GameRoomDOv2>;

    await startGame(stub, code);

    const result = await stub.playerAction(0, "void_game");
    expect(result.success).toBe(true);
  });

  it("rejects void proposal when not in playing phase", async () => {
    const code = makeCode();
    const stub = env.GAME_ROOM_DO.getByName(code) as DurableObjectStub<GameRoomDOv2>;

    await stub.joinGame(code, "alice", null);
    await stub.joinGame(code, "bob", null);

    // Still in waiting phase
    const result = await stub.playerAction(0, "void_game");
    expect(result.success).toBe(false);
    expect(result.error).toContain("未进行中");
  });

  it("allows the other player to agree and void the game", async () => {
    const code = makeCode();
    const stub = env.GAME_ROOM_DO.getByName(code) as DurableObjectStub<GameRoomDOv2>;

    await startGame(stub, code);
    // alice proposes
    const proposal = await stub.playerAction(0, "void_game");
    expect(proposal.success).toBe(true);

    // bob agrees
    const response = await stub.playerAction(1, "void_response", { agreed: true } as any);
    expect(response.success).toBe(true);

    // game should be finished
    const state = await stub.getFullStateForPlayer(-1);
    expect(state.phase).toBe("finished");
    expect(state.voided).toBe(true);
  });

  it("allows the other player to reject void proposal", async () => {
    const code = makeCode();
    const stub = env.GAME_ROOM_DO.getByName(code) as DurableObjectStub<GameRoomDOv2>;

    await startGame(stub, code);

    // alice proposes
    const proposal = await stub.playerAction(0, "void_game");
    expect(proposal.success).toBe(true);

    // bob rejects
    const response = await stub.playerAction(1, "void_response", { agreed: false } as any);
    expect(response.success).toBe(true);

    // game should still be playing
    const state = await stub.getFullStateForPlayer(-1);
    expect(state.phase).toBe("playing");
    expect(state.voidProposalSeat).toBeUndefined();
  });

  it("allows the proposer to cancel their void proposal", async () => {
    const code = makeCode();
    const stub = env.GAME_ROOM_DO.getByName(code) as DurableObjectStub<GameRoomDOv2>;

    await startGame(stub, code);

    const proposal = await stub.playerAction(0, "void_game");
    expect(proposal.success).toBe(true);

    const cancel = await stub.playerAction(0, "cancel_void");
    expect(cancel.success).toBe(true);

    const state = await stub.getFullStateForPlayer(-1);
    expect(state.voidProposalSeat).toBeUndefined();
  });

  it("blocks normal actions when void proposal is pending", async () => {
    const code = makeCode();
    const stub = env.GAME_ROOM_DO.getByName(code) as DurableObjectStub<GameRoomDOv2>;

    await startGame(stub, code);

    await stub.playerAction(0, "void_game");

    const drawResult = await stub.playerAction(0, "draw_card");
    expect(drawResult.success).toBe(false);
    expect(drawResult.error).toContain("无效局提议");
  });

  it("rejects self-response to own void proposal", async () => {
    const code = makeCode();
    const stub = env.GAME_ROOM_DO.getByName(code) as DurableObjectStub<GameRoomDOv2>;

    await startGame(stub, code);

    await stub.playerAction(0, "void_game");

    const selfResponse = await stub.playerAction(0, "void_response", { agreed: true } as any);
    expect(selfResponse.success).toBe(false);
    expect(selfResponse.error).toContain("自己的提议");
  });

  it("does not award scores on void game", async () => {
    const code = makeCode();
    const stub = env.GAME_ROOM_DO.getByName(code) as DurableObjectStub<GameRoomDOv2>;

    await startGame(stub, code);

    await stub.playerAction(0, "void_game");
    await stub.playerAction(1, "void_response", { agreed: true } as any);

    const state = await stub.getFullStateForPlayer(-1);
    expect(state.phase).toBe("finished");
    expect(state.voided).toBe(true);
  });
});