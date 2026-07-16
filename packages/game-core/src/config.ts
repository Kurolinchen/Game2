import type { BoardTile, Position } from "./types.js";

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
  spawnPoints: [
    { x: 1, y: 3 },
    { x: 6, y: 4 },
  ] satisfies readonly Position[],
  obstacles: [
    { x: 3, y: 1 },
    { x: 4, y: 1 },
    { x: 2, y: 3 },
    { x: 5, y: 4 },
    { x: 3, y: 6 },
    { x: 4, y: 6 },
  ] satisfies readonly Position[],
} as const;

export function createWarehouseTiles(): BoardTile[] {
  const obstacleKeys = new Set(
    GAME_CONFIG.obstacles.map(({ x, y }) => `${x}:${y}`),
  );

  const tiles: BoardTile[] = [];
  for (let y = 0; y < GAME_CONFIG.board.height; y += 1) {
    for (let x = 0; x < GAME_CONFIG.board.width; x += 1) {
      const isObstacle = obstacleKeys.has(`${x}:${y}`);
      tiles.push({
        x,
        y,
        type: isObstacle ? "obstacle" : "floor",
        walkable: !isObstacle,
        blocksLineOfSight: isObstacle,
      });
    }
  }

  return tiles;
}

