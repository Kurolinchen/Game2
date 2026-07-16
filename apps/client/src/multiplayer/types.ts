export interface PlayerSnapshot {
  id: string;
  displayName: string;
  slot: number;
  ready: boolean;
  connected: boolean;
}

export interface UnitSnapshot {
  id: string;
  ownerId: string;
  classId: "breacher" | "sniper" | "trickster";
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  movementRange: number;
  attackRange: number;
  attackDamage: number;
  alive: boolean;
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
}

export interface NetworkPlayerState extends PlayerSnapshot {}
export interface NetworkUnitState extends UnitSnapshot {}
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
  players: NetworkMap<NetworkPlayerState>;
  units: NetworkMap<NetworkUnitState>;
  tiles: NetworkArray<NetworkTileState>;
  winnerId: string;
}
