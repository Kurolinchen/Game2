export interface PlayerSnapshot {
  id: string;
  displayName: string;
  slot: number;
  ready: boolean;
  connected: boolean;
  isCpu: boolean;
  difficulty: string;
  rematchReady: boolean;
}

export interface PlayerStatsSnapshot {
  playerId: string;
  damageDealt: number;
  unitsEliminated: number;
  abilitiesUsed: number;
  movesMade: number;
  apSpent: number;
}

export interface UnitSnapshot {
  id: string;
  ownerId: string;
  classId: "breacher" | "sniper" | "trickster" | "decoy";
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  movementRange: number;
  attackRange: number;
  attackDamage: number;
  alive: boolean;
  isDecoy: boolean;
  sourceUnitId: string;
  movementDiscountAvailable: boolean;
  overwatchActive: boolean;
  overwatchExpiresRound: number;
  cooldowns: Record<string, number>;
}

export interface TileSnapshot {
  x: number;
  y: number;
  tileType: "floor" | "cover" | "obstacle";
  walkable: boolean;
  blocksLineOfSight: boolean;
  coverValue: number;
}

export interface MatchSnapshot {
  roomCode: string;
  status: "waiting" | "playing" | "finished";
  currentRound: number;
  activePlayerId: string;
  actionPointsRemaining: number;
  boardWidth: number;
  boardHeight: number;
  players: PlayerSnapshot[];
  units: UnitSnapshot[];
  tiles: TileSnapshot[];
  winnerId: string;
  winReason: string;
  mapId: "warehouse" | "crossfire" | "foundry";
  matchNumber: number;
  stats: PlayerStatsSnapshot[];
}

export interface NetworkPlayerState extends PlayerSnapshot {}
export interface NetworkUnitState extends Omit<UnitSnapshot, "cooldowns"> {
  cooldowns?: NetworkMap<number>;
}
export interface NetworkTileState extends TileSnapshot {}

interface NetworkMap<T> {
  forEach(callback: (value: T, key: string) => void): void;
}

interface NetworkArray<T> {
  forEach(callback: (value: T, index: number) => void): void;
}

export interface NetworkMatchState {
  roomCode: string;
  status: "waiting" | "playing" | "finished";
  currentRound: number;
  activePlayerId: string;
  actionPointsRemaining: number;
  boardWidth: number;
  boardHeight: number;
  players?: NetworkMap<NetworkPlayerState>;
  units?: NetworkMap<NetworkUnitState>;
  tiles?: NetworkArray<NetworkTileState>;
  winnerId: string;
  winReason: string;
  mapId: "warehouse" | "crossfire" | "foundry";
  matchNumber: number;
  stats?: NetworkMap<PlayerStatsSnapshot>;
}
