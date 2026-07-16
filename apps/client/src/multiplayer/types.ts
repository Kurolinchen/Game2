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
  x: number;
  y: number;
}

export interface TileSnapshot {
  x: number;
  y: number;
  tileType: "floor" | "obstacle";
  walkable: boolean;
  blocksLineOfSight: boolean;
}

export interface MatchSnapshot {
  roomCode: string;
  status: "waiting" | "playing";
  currentRound: number;
  activePlayerId: string;
  movesRemaining: number;
  boardWidth: number;
  boardHeight: number;
  players: PlayerSnapshot[];
  units: UnitSnapshot[];
  tiles: TileSnapshot[];
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
  status: "waiting" | "playing";
  currentRound: number;
  activePlayerId: string;
  movesRemaining: number;
  boardWidth: number;
  boardHeight: number;
  players: NetworkMap<NetworkPlayerState>;
  units: NetworkMap<NetworkUnitState>;
  tiles: NetworkArray<NetworkTileState>;
}

