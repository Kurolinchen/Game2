import type { MoveRequest, MoveValidation, Position } from "./types.js";

export function positionKey({ x, y }: Position): string {
  return `${x}:${y}`;
}

export function manhattanDistance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function validateMove(request: MoveRequest): MoveValidation {
  const { from, to, boardWidth, boardHeight, blocked, occupied, maxDistance } =
    request;

  if (![to.x, to.y].every(Number.isInteger)) {
    return { ok: false, reason: "invalid-coordinate" };
  }

  if (to.x < 0 || to.y < 0 || to.x >= boardWidth || to.y >= boardHeight) {
    return { ok: false, reason: "out-of-bounds" };
  }

  const distance = manhattanDistance(from, to);
  if (distance === 0) {
    return { ok: false, reason: "same-tile" };
  }

  if (distance > maxDistance) {
    return { ok: false, reason: "too-far" };
  }

  const targetKey = positionKey(to);
  if (blocked.some((position) => positionKey(position) === targetKey)) {
    return { ok: false, reason: "blocked" };
  }

  if (occupied.some((position) => positionKey(position) === targetKey)) {
    return { ok: false, reason: "occupied" };
  }

  return { ok: true };
}

