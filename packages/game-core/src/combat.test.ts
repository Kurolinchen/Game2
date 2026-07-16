import { describe, expect, it } from "vitest";
import {
  applyDamage,
  calculateModifiedDamage,
  getCoverReduction,
  hasLineOfSight,
  lineBetween,
  validateAttack,
} from "./combat.js";

const attacker = {
  id: "a",
  ownerId: "alpha",
  x: 0,
  y: 2,
  attackRange: 6,
  attackDamage: 3,
  alive: true,
};
const target = {
  id: "b",
  ownerId: "bravo",
  x: 4,
  y: 2,
  attackRange: 1,
  attackDamage: 2,
  alive: true,
};

describe("line of sight", () => {
  it("returns intermediate grid cells only", () => {
    expect(lineBetween({ x: 0, y: 2 }, { x: 3, y: 2 })).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
  });

  it("allows a clear shot", () => {
    expect(hasLineOfSight(attacker, target, [])).toBe(true);
  });

  it("blocks a shot behind a high obstacle", () => {
    expect(
      hasLineOfSight(attacker, target, [
        { x: 2, y: 2, blocksLineOfSight: true, coverValue: 0 },
      ]),
    ).toBe(false);
  });
});

describe("deterministic standard attack", () => {
  it("applies full damage to an exposed target", () => {
    expect(
      validateAttack({
        attacker,
        target,
        tiles: [],
        actionPointsAvailable: 6,
        actionPointCost: 2,
      }),
    ).toMatchObject({ ok: true, damage: 3, coverReduction: 0, cost: 2 });
  });

  it("reduces damage by adjacent low cover facing the attacker", () => {
    const tiles = [
      { x: 3, y: 2, blocksLineOfSight: false, coverValue: 1 },
    ];
    expect(getCoverReduction(attacker, target, tiles)).toBe(1);
    expect(
      validateAttack({
        attacker,
        target,
        tiles,
        actionPointsAvailable: 6,
        actionPointCost: 2,
      }),
    ).toMatchObject({ ok: true, damage: 2, coverReduction: 1 });
  });

  it("rejects friendly fire", () => {
    expect(
      validateAttack({
        attacker,
        target: { ...target, ownerId: attacker.ownerId },
        tiles: [],
        actionPointsAvailable: 6,
        actionPointCost: 2,
      }),
    ).toEqual({ ok: false, reason: "friendly-fire" });
  });

  it("rejects targets beyond range", () => {
    expect(
      validateAttack({
        attacker: { ...attacker, attackRange: 3 },
        target,
        tiles: [],
        actionPointsAvailable: 6,
        actionPointCost: 2,
      }),
    ).toEqual({ ok: false, reason: "out-of-range" });
  });

  it("rejects attacks without enough AP", () => {
    expect(
      validateAttack({
        attacker,
        target,
        tiles: [],
        actionPointsAvailable: 1,
        actionPointCost: 2,
      }),
    ).toEqual({ ok: false, reason: "insufficient-ap" });
  });

  it("clamps lethal damage at zero HP", () => {
    expect(applyDamage(2, 3)).toEqual({ hp: 0, alive: false });
  });

  it("adds Sniper damage at distance four or more", () => {
    expect(calculateModifiedDamage(3, 4, "sniper", "trickster")).toMatchObject({
      damage: 4,
      sniperBonus: 1,
    });
  });

  it("reduces adjacent damage against a Breacher but keeps one damage", () => {
    expect(calculateModifiedDamage(1, 1, "trickster", "breacher")).toMatchObject({
      damage: 1,
      breacherReduction: 1,
    });
  });
});
