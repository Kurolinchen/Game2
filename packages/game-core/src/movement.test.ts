import { describe, expect, it } from "vitest";
import { validateMove } from "./movement.js";

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

