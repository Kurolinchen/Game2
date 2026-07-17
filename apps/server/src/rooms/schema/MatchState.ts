import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import type { BoardTile } from "@tactics-lite/game-core";

export class PlayerState extends Schema {
  @type("string") id = "";
  @type("string") displayName = "";
  @type("number") slot = 0;
  @type("boolean") ready = false;
  @type("boolean") connected = true;
  @type("boolean") isCpu = false;
  @type("string") difficulty = "";
  @type("boolean") rematchReady = false;
}

export class PlayerStatsState extends Schema {
  @type("string") playerId = "";
  @type("number") damageDealt = 0;
  @type("number") unitsEliminated = 0;
  @type("number") abilitiesUsed = 0;
  @type("number") movesMade = 0;
  @type("number") apSpent = 0;
}

export class UnitState extends Schema {
  @type("string") id = "";
  @type("string") ownerId = "";
  @type("string") classId = "breacher";
  @type("string") name = "Breacher";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") hp = 0;
  @type("number") maxHp = 0;
  @type("number") movementRange = 0;
  @type("number") attackRange = 0;
  @type("number") attackDamage = 0;
  @type("boolean") alive = true;
  @type("boolean") isDecoy = false;
  @type("string") sourceUnitId = "";
  @type("boolean") movementDiscountAvailable = false;
  @type("boolean") overwatchActive = false;
  @type("number") overwatchExpiresRound = 0;
  @type({ map: "number" }) cooldowns = new MapSchema<number>();
}

export class TileState extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") tileType = "floor";
  @type("boolean") walkable = true;
  @type("boolean") blocksLineOfSight = false;
  @type("number") coverValue = 0;

  static fromTile(tile: BoardTile): TileState {
    const state = new TileState();
    state.x = tile.x;
    state.y = tile.y;
    state.tileType = tile.type;
    state.walkable = tile.walkable;
    state.blocksLineOfSight = tile.blocksLineOfSight;
    state.coverValue = tile.coverValue;
    return state;
  }
}

export class MatchState extends Schema {
  @type("string") roomCode = "";
  @type("string") status = "waiting";
  @type("number") currentRound = 0;
  @type("string") activePlayerId = "";
  @type("number") actionPointsRemaining = 0;
  @type("number") boardWidth = 0;
  @type("number") boardHeight = 0;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: UnitState }) units = new MapSchema<UnitState>();
  @type([TileState]) tiles = new ArraySchema<TileState>();
  @type("string") winnerId = "";
  @type("string") winReason = "";
  @type("string") mapId = "warehouse";
  @type("number") matchNumber = 0;
  @type({ map: PlayerStatsState }) stats = new MapSchema<PlayerStatsState>();
}
