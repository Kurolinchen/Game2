import Phaser from "phaser";
import type { MatchSnapshot } from "../multiplayer/types";

export interface TileSelection {
  x: number;
  y: number;
}

export class GameBridge extends Phaser.Events.EventEmitter {
  static readonly SNAPSHOT = "snapshot";
  static readonly TILE_SELECTED = "tile-selected";

  publishSnapshot(snapshot: MatchSnapshot, localPlayerId: string): void {
    this.emit(GameBridge.SNAPSHOT, snapshot, localPlayerId);
  }

  selectTile(selection: TileSelection): void {
    this.emit(GameBridge.TILE_SELECTED, selection);
  }
}

