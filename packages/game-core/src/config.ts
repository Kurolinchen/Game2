import type {
  AbilityDefinition,
  AbilityId,
  BoardTile,
  MapDefinition,
  MapId,
  Position,
  UnitClassId,
  UnitDefinition,
} from "./types.js";

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

export const ABILITY_DEFINITIONS = {
  "kinetic-push": {
    id: "kinetic-push",
    classId: "breacher",
    name: "Kinetic Push",
    description: "Deal 1 damage and push an adjacent enemy. A collision adds 2 damage.",
    targetType: "enemy",
    actionPointCost: 2,
    range: 1,
    cooldown: 2,
  },
  breach: {
    id: "breach",
    classId: "breacher",
    name: "Breach",
    description: "Destroy one adjacent low-cover tile.",
    targetType: "cover",
    actionPointCost: 2,
    range: 1,
    cooldown: 1,
  },
  "long-shot": {
    id: "long-shot",
    classId: "sniper",
    name: "Long Shot",
    description: "Fire up to 7 tiles. Damage scales with distance, up to 5 before modifiers.",
    targetType: "enemy",
    actionPointCost: 3,
    range: 7,
    cooldown: 2,
  },
  overwatch: {
    id: "overwatch",
    classId: "sniper",
    name: "Overwatch",
    description: "Fire once at the next enemy that moves into sight before your next turn.",
    targetType: "self",
    actionPointCost: 3,
    range: 6,
    cooldown: 2,
  },
  swap: {
    id: "swap",
    classId: "trickster",
    name: "Swap",
    description: "Exchange positions with any living unit within 4 tiles.",
    targetType: "unit",
    actionPointCost: 2,
    range: 4,
    cooldown: 2,
  },
  decoy: {
    id: "decoy",
    classId: "trickster",
    name: "Decoy",
    description: "Place a 2 HP decoy on a free visible tile within 3 tiles.",
    targetType: "tile",
    actionPointCost: 2,
    range: 3,
    cooldown: 2,
  },
} as const satisfies Record<AbilityId, AbilityDefinition>;

export const CLASS_ABILITIES = {
  breacher: ["kinetic-push", "breach"],
  sniper: ["long-shot", "overwatch"],
  trickster: ["swap", "decoy"],
} as const satisfies Record<UnitClassId, readonly AbilityId[]>;

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
    pushDamage: 1,
    pushCollisionDamage: 2,
    overwatchDamage: 2,
    decoyHp: 2,
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

const SHARED_SPAWNS = GAME_CONFIG.spawnPoints;

export const MAP_DEFINITIONS = {
  warehouse: {
    id: "warehouse",
    name: "Warehouse",
    description: "Balanced lanes with reliable cover for every class.",
    spawnPoints: SHARED_SPAWNS,
    obstacles: GAME_CONFIG.obstacles,
    cover: GAME_CONFIG.cover,
  },
  crossfire: {
    id: "crossfire",
    name: "Crossfire",
    description: "An open center rewards sight lines and careful flanking.",
    spawnPoints: SHARED_SPAWNS,
    obstacles: [
      { x: 3, y: 0 }, { x: 4, y: 0 },
      { x: 3, y: 7 }, { x: 4, y: 7 },
    ],
    cover: [
      { x: 2, y: 1 }, { x: 5, y: 1 },
      { x: 1, y: 3 }, { x: 6, y: 3 },
      { x: 1, y: 5 }, { x: 6, y: 5 },
      { x: 3, y: 4 }, { x: 4, y: 3 },
    ],
  },
  foundry: {
    id: "foundry",
    name: "Foundry",
    description: "Tight industrial lanes favor pushes, swaps, and breaches.",
    spawnPoints: SHARED_SPAWNS,
    obstacles: [
      { x: 2, y: 0 }, { x: 5, y: 0 },
      { x: 2, y: 7 }, { x: 5, y: 7 },
      { x: 3, y: 3 }, { x: 4, y: 4 },
    ],
    cover: [
      { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 4 },
      { x: 5, y: 3 }, { x: 5, y: 4 }, { x: 5, y: 5 },
      { x: 4, y: 2 }, { x: 3, y: 5 },
    ],
  },
} as const satisfies Record<MapId, MapDefinition>;

export const MAP_ORDER = ["warehouse", "crossfire", "foundry"] as const;

export function parseMapId(value: unknown): MapId {
  return typeof value === "string" && value in MAP_DEFINITIONS
    ? (value as MapId)
    : "warehouse";
}

export function createMapTiles(mapId: MapId): BoardTile[] {
  const definition = MAP_DEFINITIONS[mapId];
  const obstacleKeys = new Set(
    definition.obstacles.map(({ x, y }) => `${x}:${y}`),
  );
  const coverKeys = new Set(
    definition.cover.map(({ x, y }) => `${x}:${y}`),
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

export function createWarehouseTiles(): BoardTile[] {
  return createMapTiles("warehouse");
}
