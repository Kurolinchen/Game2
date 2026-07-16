import { manhattanDistance, positionKey } from "./movement.js";
import type { Position, PushRequest, PushResult } from "./types.js";

export function calculateLongShotBaseDamage(distance: number): number {
  return Math.min(5, 1 + Math.floor(Math.max(0, distance) / 2));
}

export function resolvePush(request: PushRequest): PushResult | null {
  const { attacker, target, boardWidth, boardHeight, blocked, occupied } = request;
  if (manhattanDistance(attacker, target) !== 1) return null;

  const destination = {
    x: target.x + (target.x - attacker.x),
    y: target.y + (target.y - attacker.y),
  };
  const destinationKey = positionKey(destination);
  const collided =
    destination.x < 0 ||
    destination.y < 0 ||
    destination.x >= boardWidth ||
    destination.y >= boardHeight ||
    blocked.some((position) => positionKey(position) === destinationKey) ||
    occupied.some((position) => positionKey(position) === destinationKey);

  return { destination: collided ? { ...target } : destination, collided };
}
