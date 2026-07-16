import { describe, expect, it } from "vitest";
import {
  findReachableTiles,
  findShortestPath,
  validateMove,
  validateMovementAction,
} from "./movement.js";

const baseRequest = {
  from: { x: 2, y: 2 },
  to: { x: 3, y: 2 },
  boardWidth: 8,
  boardHeight: 8,
  blocked: [] as const,
  occupied: [] as const,
  maxDistance: 1,
};

describe("validateMove", () => {
  it("accepts one orthogonal step onto a free tile", () => {
    expect(validateMove(baseRequest)).toEqual({ ok: true });
  });

  it.each([
    [{ x: -1, y: 2 }, "out-of-bounds"],
    [{ x: 2, y: 2 }, "same-tile"],
    [{ x: 3, y: 3 }, "too-far"],
    [{ x: 4, y: 2 }, "too-far"],
    [{ x: 2.5, y: 2 }, "invalid-coordinate"],
  ] as const)("rejects target %o as %s", (to, reason) => {
    expect(validateMove({ ...baseRequest, to })).toEqual({ ok: false, reason });
  });

  it("rejects obstacle tiles", () => {
    expect(
      validateMove({ ...baseRequest, blocked: [{ x: 3, y: 2 }] }),
    ).toEqual({ ok: false, reason: "blocked" });
  });

  it("rejects occupied tiles", () => {
    expect(
      validateMove({ ...baseRequest, occupied: [{ x: 3, y: 2 }] }),
    ).toEqual({ ok: false, reason: "occupied" });
  });
});

describe("Phase 2 movement", () => {
  it("finds the shortest orthogonal path around an obstacle", () => {
    expect(
      findShortestPath(
        { x: 0, y: 1 },
        { x: 2, y: 1 },
        5,
        5,
        [{ x: 1, y: 1 }],
        [],
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
    ]);
  });

  it("charges one AP per traversed tile", () => {
    expect(
      validateMovementAction({
        from: { x: 0, y: 0 },
        to: { x: 2, y: 0 },
        boardWidth: 5,
        boardHeight: 5,
        blocked: [],
        occupied: [],
        maxDistance: 3,
        actionPointsAvailable: 6,
        actionPointCostPerTile: 1,
      }),
    ).toMatchObject({ ok: true, cost: 2 });
  });

  it("rejects paths beyond the unit movement range", () => {
    expect(
      validateMovementAction({
        from: { x: 0, y: 0 },
        to: { x: 3, y: 0 },
        boardWidth: 5,
        boardHeight: 5,
        blocked: [],
        occupied: [],
        maxDistance: 2,
        actionPointsAvailable: 6,
        actionPointCostPerTile: 1,
      }),
    ).toEqual({ ok: false, reason: "movement-range" });
  });

  it("rejects legal-range movement when AP is insufficient", () => {
    expect(
      validateMovementAction({
        from: { x: 0, y: 0 },
        to: { x: 2, y: 0 },
        boardWidth: 5,
        boardHeight: 5,
        blocked: [],
        occupied: [],
        maxDistance: 4,
        actionPointsAvailable: 1,
        actionPointCostPerTile: 1,
      }),
    ).toEqual({ ok: false, reason: "insufficient-ap" });
  });

  it("does not path through another unit", () => {
    expect(
      findShortestPath(
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        3,
        1,
        [],
        [{ x: 1, y: 0 }],
      ),
    ).toBeNull();
  });

  it("returns only tiles affordable within the current AP pool", () => {
    const reachable = findReachableTiles(
      { x: 1, y: 1 },
      4,
      4,
      [],
      [],
      4,
      2,
      1,
    );
    expect(reachable).toContainEqual({ x: 3, y: 1 });
    expect(reachable).not.toContainEqual({ x: 3, y: 2 });
  });
});
