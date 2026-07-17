import { describe, expect, it } from "vitest";
import { calculateLongShotBaseDamage, resolvePush } from "./abilities.js";

describe("Phase 3 abilities", () => {
  it("scales Long Shot damage with distance and caps it", () => {
    expect(calculateLongShotBaseDamage(1)).toBe(1);
    expect(calculateLongShotBaseDamage(4)).toBe(3);
    expect(calculateLongShotBaseDamage(12)).toBe(5);
  });

  it("pushes an adjacent target one tile away", () => {
    expect(
      resolvePush({
        attacker: { x: 1, y: 1 },
        target: { x: 2, y: 1 },
        boardWidth: 8,
        boardHeight: 8,
        blocked: [],
        occupied: [],
      }),
    ).toEqual({ destination: { x: 3, y: 1 }, collided: false });
  });

  it("keeps the target in place on a collision", () => {
    expect(
      resolvePush({
        attacker: { x: 1, y: 1 },
        target: { x: 2, y: 1 },
        boardWidth: 8,
        boardHeight: 8,
        blocked: [{ x: 3, y: 1 }],
        occupied: [],
      }),
    ).toEqual({ destination: { x: 2, y: 1 }, collided: true });
  });
});
