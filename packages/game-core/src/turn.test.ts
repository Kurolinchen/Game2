import { describe, expect, it } from "vitest";
import { nextTurn } from "./turn.js";

describe("nextTurn", () => {
  it("hands the turn to the second player without incrementing the round", () => {
    expect(nextTurn(["a", "b"], "a", 1)).toEqual({
      activePlayerId: "b",
      round: 1,
    });
  });

  it("increments the round after the last player", () => {
    expect(nextTurn(["a", "b"], "b", 3)).toEqual({
      activePlayerId: "a",
      round: 4,
    });
  });

  it("recovers deterministically when the active player is missing", () => {
    expect(nextTurn(["a", "b"], "missing", 2)).toEqual({
      activePlayerId: "a",
      round: 2,
    });
  });

  it("rejects an empty turn order", () => {
    expect(() => nextTurn([], "", 1)).toThrow(
      "Cannot advance a turn without players.",
    );
  });
});
