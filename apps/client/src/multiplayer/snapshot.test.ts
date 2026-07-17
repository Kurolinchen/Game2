import { describe, expect, it } from "vitest";
import { toMatchSnapshot } from "./snapshot";
import type { NetworkMatchState } from "./types";

describe("toMatchSnapshot", () => {
  it("handles the initial room state before schema collections arrive", () => {
    const state: NetworkMatchState = {
      roomCode: "ABC123",
      status: "waiting",
      currentRound: 0,
      activePlayerId: "",
      actionPointsRemaining: 0,
      boardWidth: 8,
      boardHeight: 8,
      players: undefined,
      units: undefined,
      tiles: undefined,
      winnerId: "",
    };

    expect(toMatchSnapshot(state)).toMatchObject({
      roomCode: "ABC123",
      players: [],
      units: [],
      tiles: [],
    });
  });
});
