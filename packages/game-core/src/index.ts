export {
  GAME_CONFIG,
  UNIT_CLASS_ORDER,
  UNIT_DEFINITIONS,
  createWarehouseTiles,
} from "./config.js";
export {
  findReachableTiles,
  findShortestPath,
  manhattanDistance,
  positionKey,
  validateMove,
  validateMovementAction,
} from "./movement.js";
export {
  applyDamage,
  getCoverReduction,
  hasLineOfSight,
  lineBetween,
  validateAttack,
} from "./combat.js";
export { nextTurn } from "./turn.js";
export type {
  BoardTile,
  AttackRejection,
  AttackRequest,
  AttackTile,
  AttackUnit,
  AttackValidation,
  MoveRejection,
  MoveRequest,
  MoveValidation,
  Position,
  TileType,
  TurnResult,
  MovementActionRejection,
  MovementActionRequest,
  MovementActionValidation,
  UnitClassId,
  UnitDefinition,
} from "./types.js";
