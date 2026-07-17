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

export interface BoardPoint {
  x: number;
  y: number;
}

export interface BoardActionEvent {
  id: number;
  type?: "move" | "attack" | "ability" | "overwatch";
  unitId?: string;
  attackerId?: string;
  targetId?: string;
  abilityId?: AbilityId;
  abilityName?: string;
  damage?: number;
  coverReduction?: number;
  eliminated?: boolean;
  apCost?: number;
  x?: number;
  y?: number;
  path?: BoardPoint[];
  unitPosition?: BoardPoint;
  targetPosition?: BoardPoint;
  destroyedCover?: boolean;
  collided?: boolean;
  decoyId?: string;
}

interface PublishedSnapshot {
  snapshot: MatchSnapshot;
  localPlayerId: string;
  context: BoardInteractionContext;
}

export class GameBridge extends Phaser.Events.EventEmitter {
  static readonly SNAPSHOT = "snapshot";
  static readonly SELECTION = "selection";
  static readonly ACTION = "action";

  private latestSnapshot?: PublishedSnapshot;
  private latestAction?: BoardActionEvent;

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

  publishAction(action: BoardActionEvent): void {
    this.latestAction = action;
    this.emit(GameBridge.ACTION, action);
  }

  replayLatestAction(): boolean {
    if (!this.latestAction) {
      return false;
    }

    this.emit(GameBridge.ACTION, this.latestAction);
    return true;
  }

  select(selection: BoardSelection): void {
    this.emit(GameBridge.SELECTION, selection);
  }
}
