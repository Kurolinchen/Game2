export interface Position {
  x: number;
  y: number;
}

export type TileType = "floor" | "cover" | "obstacle";

export interface BoardTile extends Position {
  type: TileType;
  walkable: boolean;
  blocksLineOfSight: boolean;
  coverValue: number;
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

export type UnitClassId = "breacher" | "sniper" | "trickster";

export interface UnitDefinition {
  classId: UnitClassId;
  name: string;
  role: string;
  maxHp: number;
  movementRange: number;
  attackRange: number;
  attackDamage: number;
}

export interface MovementActionRequest {
  from: Position;
  to: Position;
  boardWidth: number;
  boardHeight: number;
  blocked: readonly Position[];
  occupied: readonly Position[];
  maxDistance: number;
  actionPointsAvailable: number;
  actionPointCostPerTile: number;
}

export type MovementActionRejection =
  | "invalid-coordinate"
  | "out-of-bounds"
  | "same-tile"
  | "unreachable"
  | "movement-range"
  | "insufficient-ap";

export type MovementActionValidation =
  | { ok: true; path: Position[]; cost: number }
  | { ok: false; reason: MovementActionRejection };

export interface AttackUnit extends Position {
  id: string;
  ownerId: string;
  attackRange: number;
  attackDamage: number;
  alive: boolean;
}

export interface AttackTile extends Position {
  blocksLineOfSight: boolean;
  coverValue: number;
}

export interface AttackRequest {
  attacker: AttackUnit;
  target: AttackUnit;
  tiles: readonly AttackTile[];
  actionPointsAvailable: number;
  actionPointCost: number;
}

export type AttackRejection =
  | "attacker-dead"
  | "target-dead"
  | "friendly-fire"
  | "out-of-range"
  | "blocked-line-of-sight"
  | "insufficient-ap";

export type AttackValidation =
  | {
      ok: true;
      cost: number;
      damage: number;
      coverReduction: number;
      distance: number;
    }
  | { ok: false; reason: AttackRejection };
