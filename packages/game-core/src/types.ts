export interface Position {
  x: number;
  y: number;
}

export type TileType = "floor" | "obstacle";

export interface BoardTile extends Position {
  type: TileType;
  walkable: boolean;
  blocksLineOfSight: boolean;
}

export interface MoveRequest {
  from: Position;
  to: Position;
  boardWidth: number;
  boardHeight: number;
  blocked: readonly Position[];
  occupied: readonly Position[];
  maxDistance: number;
}

export type MoveRejection =
  | "invalid-coordinate"
  | "out-of-bounds"
  | "same-tile"
  | "too-far"
  | "blocked"
  | "occupied";

export type MoveValidation =
  | { ok: true }
  | { ok: false; reason: MoveRejection };

export interface TurnResult {
  activePlayerId: string;
  round: number;
}

