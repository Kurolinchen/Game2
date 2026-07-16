import type { BoardTile, Position, UnitDefinition } from "./types.js";

export const UNIT_DEFINITIONS = {
  breacher: {
    classId: "breacher",
    name: "Breacher",
    role: "Close-range control",
    maxHp: 10,
    movementRange: 3,
    attackRange: 1,
    attackDamage: 3,
  },
  sniper: {
    classId: "sniper",
    name: "Sniper",
    role: "Long-range pressure",
    maxHp: 5,
    movementRange: 2,
    attackRange: 6,
    attackDamage: 3,
  },
  trickster: {
    classId: "trickster",
    name: "Trickster",
    role: "Mobile disruption",
    maxHp: 6,
    movementRange: 4,
    attackRange: 2,
    attackDamage: 2,
  },
} as const satisfies Record<string, UnitDefinition>;

export const UNIT_CLASS_ORDER = ["breacher", "sniper", "trickster"] as const;

export const GAME_CONFIG = {
  room: {
    maxPlayers: 2,
    codeLength: 6,
  },
  board: {
    width: 8,
    height: 8,
  },
  phaseOne: {
    movesPerTurn: 1,
    moveDistance: 1,
  },
  actions: {
    actionPointsPerTurn: 6,
    movementCostPerTile: 1,
    standardAttackCost: 2,
  },
  spawnPoints: [
    [
      { x: 0, y: 1 },
      { x: 0, y: 3 },
      { x: 0, y: 6 },
    ],
    [
      { x: 7, y: 1 },
      { x: 7, y: 4 },
      { x: 7, y: 6 },
    ],
  ] satisfies readonly (readonly Position[])[],
  obstacles: [
    { x: 3, y: 1 },
    { x: 4, y: 1 },
    { x: 3, y: 6 },
    { x: 4, y: 6 },
  ] satisfies readonly Position[],
  cover: [
    { x: 2, y: 2 },
    { x: 5, y: 2 },
    { x: 2, y: 5 },
    { x: 5, y: 5 },
    { x: 3, y: 3 },
    { x: 4, y: 4 },
  ] satisfies readonly Position[],
} as const;

export function createWarehouseTiles(): BoardTile[] {
  const obstacleKeys = new Set(
    GAME_CONFIG.obstacles.map(({ x, y }) => `${x}:${y}`),
  );
  const coverKeys = new Set(
    GAME_CONFIG.cover.map(({ x, y }) => `${x}:${y}`),
  );

  const tiles: BoardTile[] = [];
  for (let y = 0; y < GAME_CONFIG.board.height; y += 1) {
    for (let x = 0; x < GAME_CONFIG.board.width; x += 1) {
      const isObstacle = obstacleKeys.has(`${x}:${y}`);
      const isCover = coverKeys.has(`${x}:${y}`);
      tiles.push({
        x,
        y,
        type: isObstacle ? "obstacle" : isCover ? "cover" : "floor",
        walkable: !isObstacle && !isCover,
        blocksLineOfSight: isObstacle,
        coverValue: isCover ? 1 : 0,
      });
    }
  }

  return tiles;
}
