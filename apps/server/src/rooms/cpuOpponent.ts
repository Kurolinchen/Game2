import {
  ABILITY_DEFINITIONS,
  GAME_CONFIG,
  calculateLongShotBaseDamage,
  calculateModifiedDamage,
  findReachableTiles,
  getCoverReduction,
  hasLineOfSight,
  manhattanDistance,
  resolvePush,
  validateAttack,
  validateMovementAction,
  type AbilityId,
  type AttackTile,
  type Position,
} from "@tactics-lite/game-core";

export type CpuDifficulty = "easy" | "normal" | "hard";

export const CPU_DIFFICULTY_LABELS: Record<CpuDifficulty, string> = {
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
};

export const CPU_PLAYER_ID = "cpu-opponent";

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface CpuUnit extends Position {
  id: string;
  ownerId: string;
  classId: string;
  hp: number;
  alive: boolean;
  isDecoy: boolean;
  movementRange: number;
  attackRange: number;
  attackDamage: number;
  movementDiscountAvailable: boolean;
  overwatchActive: boolean;
  cooldowns: Readonly<Record<string, number>>;
}

export interface CpuTile extends AttackTile {
  walkable: boolean;
}

export type CpuAction =
  | { type: "attack"; attackerId: string; targetId: string }
  | { type: "move"; unitId: string; x: number; y: number }
  | {
      type: "ability";
      unitId: string;
      abilityId: AbilityId;
      targetUnitId?: string;
    }
  | { type: "end_turn" };

export interface CpuDecisionContext {
  difficulty: CpuDifficulty;
  playerId: string;
  actionPoints: number;
  boardWidth: number;
  boardHeight: number;
  units: readonly CpuUnit[];
  tiles: readonly CpuTile[];
  random?: () => number;
}

interface ScoredAction {
  action: CpuAction;
  score: number;
}

export function parseCpuDifficulty(value: unknown): CpuDifficulty {
  return value === "easy" || value === "hard" || value === "normal"
    ? value
    : "normal";
}

export function chooseCpuAction(context: CpuDecisionContext): CpuAction {
  const allies = context.units.filter(
    (unit) => unit.ownerId === context.playerId && unit.alive && !unit.isDecoy,
  );
  const enemies = context.units.filter(
    (unit) => unit.ownerId !== context.playerId && unit.alive,
  );
  if (allies.length === 0 || enemies.length === 0 || context.actionPoints <= 0) {
    return { type: "end_turn" };
  }

  const attacks = legalAttacks(context, allies, enemies);
  const moves = legalMoves(context, allies, enemies);

  if (context.difficulty === "easy") {
    const random = context.random ?? Math.random;
    const choices = [...attacks, ...moves];
    if (choices.length === 0 || random() < 0.18) return { type: "end_turn" };
    const index = Math.min(choices.length - 1, Math.floor(random() * choices.length));
    return choices[index]!.action;
  }

  if (context.difficulty === "normal") {
    return bestAction(attacks)?.action ?? bestAction(moves)?.action ?? {
      type: "end_turn",
    };
  }

  const abilities = legalHardAbilities(context, allies, enemies);
  const offensive = [...attacks, ...abilities.filter((candidate) => candidate.score >= 100)];
  const bestOffensive = bestAction(offensive);
  if (bestOffensive) return bestOffensive.action;

  const tactical = [...moves, ...abilities];
  return bestAction(tactical)?.action ?? { type: "end_turn" };
}

function legalAttacks(
  context: CpuDecisionContext,
  allies: readonly CpuUnit[],
  enemies: readonly CpuUnit[],
): ScoredAction[] {
  const attacks: ScoredAction[] = [];
  for (const attacker of allies) {
    for (const target of enemies) {
      const validation = validateAttack({
        attacker,
        target,
        tiles: context.tiles,
        actionPointsAvailable: context.actionPoints,
        actionPointCost: GAME_CONFIG.actions.standardAttackCost,
      });
      if (!validation.ok) continue;
      attacks.push({
        action: { type: "attack", attackerId: attacker.id, targetId: target.id },
        score: damageScore(validation.damage, target, 120),
      });
    }
  }
  return attacks;
}

function legalMoves(
  context: CpuDecisionContext,
  allies: readonly CpuUnit[],
  enemies: readonly CpuUnit[],
): ScoredAction[] {
  const blocked = context.tiles
    .filter((tile) => !tile.walkable)
    .map(({ x, y }) => ({ x, y }));
  const moves: ScoredAction[] = [];

  for (const unit of allies) {
    const occupied = context.units
      .filter((candidate) => candidate.alive && candidate.id !== unit.id)
      .map(({ x, y }) => ({ x, y }));
    const reachable = findReachableTiles(
      unit,
      context.boardWidth,
      context.boardHeight,
      blocked,
      occupied,
      unit.movementRange,
      context.actionPoints,
      GAME_CONFIG.actions.movementCostPerTile,
      unit.movementDiscountAvailable ? 1 : 0,
    );
    const currentDistance = nearestDistance(unit, enemies);

    for (const destination of reachable) {
      const validation = validateMovementAction({
        from: unit,
        to: destination,
        boardWidth: context.boardWidth,
        boardHeight: context.boardHeight,
        blocked,
        occupied,
        maxDistance: unit.movementRange,
        actionPointsAvailable: context.actionPoints,
        actionPointCostPerTile: GAME_CONFIG.actions.movementCostPerTile,
        actionPointDiscount: unit.movementDiscountAvailable ? 1 : 0,
      });
      if (!validation.ok) continue;

      const movedUnit = { ...unit, ...destination };
      const nextDistance = nearestDistance(movedUnit, enemies);
      let score = (currentDistance - nextDistance) * 40 - validation.cost;

      if (context.difficulty === "hard") {
        const remainingAp = context.actionPoints - validation.cost;
        const followUpDamage = enemies.reduce((best, target) => {
          const attack = validateAttack({
            attacker: movedUnit,
            target,
            tiles: context.tiles,
            actionPointsAvailable: remainingAp,
            actionPointCost: GAME_CONFIG.actions.standardAttackCost,
          });
          return attack.ok ? Math.max(best, attack.damage) : best;
        }, 0);
        score += followUpDamage > 0 ? 260 + followUpDamage * 20 : 0;
        if (unit.classId === "sniper") {
          score += 35 - Math.abs(nextDistance - 5) * 8;
        } else {
          score += 30 - nextDistance * 4;
        }
      }

      moves.push({
        action: { type: "move", unitId: unit.id, ...destination },
        score,
      });
    }
  }
  return moves;
}

function legalHardAbilities(
  context: CpuDecisionContext,
  allies: readonly CpuUnit[],
  enemies: readonly CpuUnit[],
): ScoredAction[] {
  const candidates: ScoredAction[] = [];
  const blocked = context.tiles
    .filter((tile) => !tile.walkable)
    .map(({ x, y }) => ({ x, y }));

  for (const unit of allies) {
    if (
      unit.classId === "breacher" &&
      abilityReady(unit, "kinetic-push", context.actionPoints)
    ) {
      for (const target of enemies) {
        const occupied = context.units
          .filter(
            (candidate) =>
              candidate.alive && candidate.id !== target.id && candidate.id !== unit.id,
          )
          .map(({ x, y }) => ({ x, y }));
        const push = resolvePush({
          attacker: unit,
          target,
          boardWidth: context.boardWidth,
          boardHeight: context.boardHeight,
          blocked,
          occupied,
        });
        if (!push) continue;
        const baseDamage =
          GAME_CONFIG.actions.pushDamage +
          (push.collided ? GAME_CONFIG.actions.pushCollisionDamage : 0);
        const damage = calculateModifiedDamage(
          baseDamage,
          1,
          "breacher",
          combatClass(target),
        ).damage;
        candidates.push({
          action: {
            type: "ability",
            unitId: unit.id,
            abilityId: "kinetic-push",
            targetUnitId: target.id,
          },
          score: damageScore(damage, target, push.collided ? 180 : 130),
        });
      }
    }

    if (
      unit.classId === "sniper" &&
      abilityReady(unit, "long-shot", context.actionPoints)
    ) {
      for (const target of enemies) {
        const distance = manhattanDistance(unit, target);
        if (
          distance > ABILITY_DEFINITIONS["long-shot"].range ||
          !hasLineOfSight(unit, target, context.tiles)
        ) {
          continue;
        }
        const cover = getCoverReduction(unit, target, context.tiles);
        const damage = calculateModifiedDamage(
          calculateLongShotBaseDamage(distance),
          distance,
          "sniper",
          combatClass(target),
          cover,
        ).damage;
        candidates.push({
          action: {
            type: "ability",
            unitId: unit.id,
            abilityId: "long-shot",
            targetUnitId: target.id,
          },
          score: damageScore(damage, target, 170),
        });
      }
    }

    if (
      unit.classId === "sniper" &&
      !unit.overwatchActive &&
      abilityReady(unit, "overwatch", context.actionPoints)
    ) {
      candidates.push({
        action: {
          type: "ability",
          unitId: unit.id,
          abilityId: "overwatch",
        },
        score: 35,
      });
    }
  }
  return candidates;
}

function abilityReady(
  unit: CpuUnit,
  abilityId: AbilityId,
  actionPoints: number,
): boolean {
  const ability = ABILITY_DEFINITIONS[abilityId];
  return (
    (unit.cooldowns[abilityId] ?? 0) === 0 &&
    actionPoints >= ability.actionPointCost
  );
}

function damageScore(damage: number, target: CpuUnit, base: number): number {
  return (
    base +
    damage * 30 +
    (damage >= target.hp ? 600 : 0) +
    Math.max(0, 12 - target.hp) -
    (target.isDecoy ? 180 : 0)
  );
}

function nearestDistance(position: Position, enemies: readonly CpuUnit[]): number {
  return Math.min(...enemies.map((enemy) => manhattanDistance(position, enemy)));
}

function combatClass(
  unit: CpuUnit,
): "breacher" | "sniper" | "trickster" | undefined {
  return unit.classId === "breacher" ||
    unit.classId === "sniper" ||
    unit.classId === "trickster"
    ? unit.classId
    : undefined;
}

function bestAction(actions: readonly ScoredAction[]): ScoredAction | undefined {
  return actions.reduce<ScoredAction | undefined>(
    (best, candidate) => (!best || candidate.score > best.score ? candidate : best),
    undefined,
  );
}
