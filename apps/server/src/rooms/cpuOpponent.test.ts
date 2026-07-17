import { describe, expect, it } from "vitest";
import { chooseCpuAction, parseCpuDifficulty, type CpuDecisionContext } from "./cpuOpponent.js";

const floorTiles = Array.from({ length: 8 * 8 }, (_, index) => ({
  x: index % 8,
  y: Math.floor(index / 8),
  walkable: true,
  blocksLineOfSight: false,
  coverValue: 0,
}));

function context(overrides: Partial<CpuDecisionContext> = {}): CpuDecisionContext {
  return {
    difficulty: "normal",
    playerId: "cpu",
    actionPoints: 6,
    boardWidth: 8,
    boardHeight: 8,
    tiles: floorTiles,
    units: [
      {
        id: "cpu-sniper",
        ownerId: "cpu",
        classId: "sniper",
        x: 0,
        y: 0,
        hp: 5,
        alive: true,
        isDecoy: false,
        movementRange: 2,
        attackRange: 6,
        attackDamage: 3,
        movementDiscountAvailable: false,
        overwatchActive: false,
        cooldowns: { "long-shot": 0, overwatch: 0 },
      },
      {
        id: "human-breacher",
        ownerId: "human",
        classId: "breacher",
        x: 4,
        y: 0,
        hp: 3,
        alive: true,
        isDecoy: false,
        movementRange: 3,
        attackRange: 1,
        attackDamage: 3,
        movementDiscountAvailable: false,
        overwatchActive: false,
        cooldowns: {},
      },
    ],
    ...overrides,
  };
}

describe("CPU opponent", () => {
  it("defaults unknown difficulties to normal", () => {
    expect(parseCpuDifficulty("impossible")).toBe("normal");
  });

  it("normal difficulty prioritizes a legal attack", () => {
    expect(chooseCpuAction(context())).toEqual({
      type: "attack",
      attackerId: "cpu-sniper",
      targetId: "human-breacher",
    });
  });

  it("hard difficulty uses a lethal long shot", () => {
    expect(chooseCpuAction(context({ difficulty: "hard" }))).toEqual({
      type: "ability",
      unitId: "cpu-sniper",
      abilityId: "long-shot",
      targetUnitId: "human-breacher",
    });
  });

  it("moves closer when no attack is available", () => {
    const decision = chooseCpuAction(
      context({
        units: [
          { ...context().units[0]!, attackRange: 1 },
          { ...context().units[1]!, x: 7, y: 7 },
        ],
      }),
    );
    expect(decision.type).toBe("move");
  });

  it("easy difficulty can intentionally end its turn", () => {
    expect(
      chooseCpuAction(context({ difficulty: "easy", random: () => 0 })),
    ).toEqual({ type: "end_turn" });
  });
});
