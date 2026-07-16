import { manhattanDistance, positionKey } from "./movement.js";
import type {
  AttackRequest,
  AttackTile,
  AttackValidation,
  Position,
} from "./types.js";

export function lineBetween(from: Position, to: Position): Position[] {
  const points: Position[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const stepX = from.x < to.x ? 1 : -1;
  const stepY = from.y < to.y ? 1 : -1;
  let error = dx - dy;

  while (x !== to.x || y !== to.y) {
    const doubled = error * 2;
    if (doubled > -dy) {
      error -= dy;
      x += stepX;
    }
    if (doubled < dx) {
      error += dx;
      y += stepY;
    }
    if (x !== to.x || y !== to.y) points.push({ x, y });
  }
  return points;
}

export function hasLineOfSight(
  from: Position,
  to: Position,
  tiles: readonly AttackTile[],
): boolean {
  const blocking = new Set(
    tiles
      .filter((tile) => tile.blocksLineOfSight)
      .map((tile) => positionKey(tile)),
  );
  return lineBetween(from, to).every(
    (position) => !blocking.has(positionKey(position)),
  );
}

export function getCoverReduction(
  attacker: Position,
  target: Position,
  tiles: readonly AttackTile[],
): number {
  const deltaX = attacker.x - target.x;
  const deltaY = attacker.y - target.y;
  const direction =
    Math.abs(deltaX) >= Math.abs(deltaY)
      ? { x: Math.sign(deltaX), y: 0 }
      : { x: 0, y: Math.sign(deltaY) };
  const coverPosition = {
    x: target.x + direction.x,
    y: target.y + direction.y,
  };
  return (
    tiles.find((tile) => positionKey(tile) === positionKey(coverPosition))
      ?.coverValue ?? 0
  );
}

export function validateAttack(request: AttackRequest): AttackValidation {
  const { attacker, target, tiles, actionPointsAvailable, actionPointCost } =
    request;
  if (!attacker.alive) return { ok: false, reason: "attacker-dead" };
  if (!target.alive) return { ok: false, reason: "target-dead" };
  if (attacker.ownerId === target.ownerId) {
    return { ok: false, reason: "friendly-fire" };
  }
  if (actionPointCost > actionPointsAvailable) {
    return { ok: false, reason: "insufficient-ap" };
  }

  const distance = manhattanDistance(attacker, target);
  if (distance > attacker.attackRange) {
    return { ok: false, reason: "out-of-range" };
  }
  if (!hasLineOfSight(attacker, target, tiles)) {
    return { ok: false, reason: "blocked-line-of-sight" };
  }

  const coverReduction = getCoverReduction(attacker, target, tiles);
  return {
    ok: true,
    cost: actionPointCost,
    damage: Math.max(1, attacker.attackDamage - coverReduction),
    coverReduction,
    distance,
  };
}

export function applyDamage(currentHp: number, damage: number): {
  hp: number;
  alive: boolean;
} {
  const hp = Math.max(0, currentHp - Math.max(0, damage));
  return { hp, alive: hp > 0 };
}
