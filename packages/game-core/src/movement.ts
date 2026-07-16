import type {
  MoveRequest,
  MoveValidation,
  MovementActionRequest,
  MovementActionValidation,
  Position,
} from "./types.js";

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

const ORTHOGONAL_DIRECTIONS: readonly Position[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

function isIntegerPosition(position: Position): boolean {
  return Number.isInteger(position.x) && Number.isInteger(position.y);
}

function isInside(position: Position, width: number, height: number): boolean {
  return (
    position.x >= 0 &&
    position.y >= 0 &&
    position.x < width &&
    position.y < height
  );
}

export function findShortestPath(
  from: Position,
  to: Position,
  boardWidth: number,
  boardHeight: number,
  blocked: readonly Position[],
  occupied: readonly Position[],
): Position[] | null {
  if (!isInside(from, boardWidth, boardHeight) || !isInside(to, boardWidth, boardHeight)) {
    return null;
  }

  const unavailable = new Set(
    [...blocked, ...occupied].map((position) => positionKey(position)),
  );
  const startKey = positionKey(from);
  const targetKey = positionKey(to);
  unavailable.delete(startKey);
  if (unavailable.has(targetKey)) return null;

  const queue: Position[] = [from];
  const previous = new Map<string, string | null>([[startKey, null]]);
  const positions = new Map<string, Position>([[startKey, from]]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentKey = positionKey(current);
    if (currentKey === targetKey) break;

    for (const direction of ORTHOGONAL_DIRECTIONS) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      const nextKey = positionKey(next);
      if (
        !isInside(next, boardWidth, boardHeight) ||
        unavailable.has(nextKey) ||
        previous.has(nextKey)
      ) {
        continue;
      }
      previous.set(nextKey, currentKey);
      positions.set(nextKey, next);
      queue.push(next);
    }
  }

  if (!previous.has(targetKey)) return null;

  const path: Position[] = [];
  let cursor: string | null = targetKey;
  while (cursor && cursor !== startKey) {
    const position = positions.get(cursor);
    if (!position) return null;
    path.unshift(position);
    cursor = previous.get(cursor) ?? null;
  }
  return path;
}

export function validateMovementAction(
  request: MovementActionRequest,
): MovementActionValidation {
  const {
    from,
    to,
    boardWidth,
    boardHeight,
    blocked,
    occupied,
    maxDistance,
    actionPointsAvailable,
    actionPointCostPerTile,
    actionPointDiscount = 0,
  } = request;

  if (!isIntegerPosition(to)) {
    return { ok: false, reason: "invalid-coordinate" };
  }
  if (!isInside(to, boardWidth, boardHeight)) {
    return { ok: false, reason: "out-of-bounds" };
  }
  if (positionKey(from) === positionKey(to)) {
    return { ok: false, reason: "same-tile" };
  }

  const path = findShortestPath(
    from,
    to,
    boardWidth,
    boardHeight,
    blocked,
    occupied,
  );
  if (!path) return { ok: false, reason: "unreachable" };
  if (path.length > maxDistance) {
    return { ok: false, reason: "movement-range" };
  }

  const cost = Math.max(
    0,
    path.length * actionPointCostPerTile - Math.max(0, actionPointDiscount),
  );
  if (cost > actionPointsAvailable) {
    return { ok: false, reason: "insufficient-ap" };
  }
  return { ok: true, path, cost };
}

export function findReachableTiles(
  from: Position,
  boardWidth: number,
  boardHeight: number,
  blocked: readonly Position[],
  occupied: readonly Position[],
  maxDistance: number,
  actionPointsAvailable: number,
  actionPointCostPerTile: number,
  actionPointDiscount = 0,
): Position[] {
  const effectiveRange = Math.min(
    maxDistance,
    Math.floor(
      (actionPointsAvailable + Math.max(0, actionPointDiscount)) /
        actionPointCostPerTile,
    ),
  );
  const reachable: Position[] = [];

  for (let y = 0; y < boardHeight; y += 1) {
    for (let x = 0; x < boardWidth; x += 1) {
      const target = { x, y };
      if (positionKey(target) === positionKey(from)) continue;
      const path = findShortestPath(
        from,
        target,
        boardWidth,
        boardHeight,
        blocked,
        occupied,
      );
      if (path && path.length <= effectiveRange) reachable.push(target);
    }
  }
  return reachable;
}
