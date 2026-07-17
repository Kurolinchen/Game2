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

interface PublishedSnapshot {
  snapshot: MatchSnapshot;
  localPlayerId: string;
  context: BoardInteractionContext;
}

export class GameBridge extends Phaser.Events.EventEmitter {
  static readonly SNAPSHOT = "snapshot";
  static readonly SELECTION = "selection";

  private latestSnapshot?: PublishedSnapshot;

  publishSnapshot(
    snapshot: MatchSnapshot,
    localPlayerId: string,
    context: BoardInteractionContext,
  ): void {
    this.latestSnapshot = {
      snapshot,
      localPlayerId,
      context: { ...context },
    };
    this.emit(GameBridge.SNAPSHOT, snapshot, localPlayerId, context);
  }

  replayLatestSnapshot(): boolean {
    if (!this.latestSnapshot) {
      return false;
    }

    const { snapshot, localPlayerId, context } = this.latestSnapshot;
    this.emit(GameBridge.SNAPSHOT, snapshot, localPlayerId, context);
    return true;
  }

  select(selection: BoardSelection): void {
    this.emit(GameBridge.SELECTION, selection);
  }
}
