import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import type { BoardTile } from "@tactics-lite/game-core";

export class PlayerState extends Schema {
  @type("string") id = "";
  @type("string") displayName = "";
  @type("number") slot = 0;
  @type("boolean") ready = false;
  @type("boolean") connected = true;
}

export class UnitState extends Schema {
  @type("string") id = "";
  @type("string") ownerId = "";
  @type("number") x = 0;
  @type("number") y = 0;
}

export class TileState extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") tileType = "floor";
  @type("boolean") walkable = true;
  @type("boolean") blocksLineOfSight = false;

  static fromTile(tile: BoardTile): TileState {
    const state = new TileState();
    state.x = tile.x;
    state.y = tile.y;
    state.tileType = tile.type;
    state.walkable = tile.walkable;
    state.blocksLineOfSight = tile.blocksLineOfSight;
    return state;
  }
}

export class MatchState extends Schema {
  @type("string") roomCode = "";
  @type("string") status = "waiting";
  @type("number") currentRound = 0;
  @type("string") activePlayerId = "";
  @type("number") movesRemaining = 0;
  @type("number") boardWidth = 0;
  @type("number") boardHeight = 0;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: UnitState }) units = new MapSchema<UnitState>();
  @type([TileState]) tiles = new ArraySchema<TileState>();
}

