import Phaser from "phaser";
import type { AbilityId } from "@tactics-lite/game-core";
import type { MatchSnapshot } from "../multiplayer/types";

export type ActionMode = "move" | "attack" | AbilityId;

export interface BoardInteractionContext {
  selectedUnitId: string;
  actionMode: ActionMode;
}

export type BoardSelection =
  | { type: "tile"; x: number; y: number }
  | { type: "unit"; unitId: string };

export interface TileSelection {
  x: number;
  y: number;
}

export class GameBridge extends Phaser.Events.EventEmitter {
  static readonly SNAPSHOT = "snapshot";
  static readonly SELECTION = "selection";

  publishSnapshot(
    snapshot: MatchSnapshot,
    localPlayerId: string,
    context: BoardInteractionContext,
  ): void {
    this.emit(GameBridge.SNAPSHOT, snapshot, localPlayerId, context);
  }

  select(selection: BoardSelection): void {
    this.emit(GameBridge.SELECTION, selection);
  }
}
