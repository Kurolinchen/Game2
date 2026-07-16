export {
  ABILITY_DEFINITIONS,
  CLASS_ABILITIES,
  GAME_CONFIG,
  UNIT_CLASS_ORDER,
  UNIT_DEFINITIONS,
  createWarehouseTiles,
} from "./config.js";
export { calculateLongShotBaseDamage, resolvePush } from "./abilities.js";
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
  calculateModifiedDamage,
  getCoverReduction,
  hasLineOfSight,
  lineBetween,
  validateAttack,
} from "./combat.js";
export { nextTurn } from "./turn.js";
export type {
  AbilityDefinition,
  AbilityId,
  AbilityTargetType,
  BoardTile,
  DamageCalculation,
  AttackRejection,
  AttackRequest,
  AttackTile,
  AttackUnit,
  AttackValidation,
  MoveRejection,
  MoveRequest,
  MoveValidation,
  Position,
  PushRequest,
  PushResult,
  TileType,
  TurnResult,
  MovementActionRejection,
  MovementActionRequest,
  MovementActionValidation,
  UnitClassId,
  UnitDefinition,
} from "./types.js";
