import Phaser from "phaser";
import { GAME_CONFIG, manhattanDistance } from "@tactics-lite/game-core";
import { GameBridge } from "./GameBridge";
import type { MatchSnapshot, UnitSnapshot } from "../multiplayer/types";

const CANVAS_SIZE = 720;
const BOARD_PADDING = 56;
const TILE_SIZE = (CANVAS_SIZE - BOARD_PADDING * 2) / GAME_CONFIG.board.width;

export class BoardScene extends Phaser.Scene {
  private bridge: GameBridge;
  private snapshot?: MatchSnapshot;
  private localPlayerId = "";
  private selectedUnitId = "";
  private graphics?: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];

  constructor(bridge: GameBridge) {
    super({ key: "BoardScene" });
    this.bridge = bridge;
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#0b101a");
    this.graphics = this.add.graphics();
    this.input.on("pointerup", this.handlePointer, this);
    this.bridge.on(GameBridge.SNAPSHOT, this.receiveSnapshot, this);
    this.renderBoard();
  }

  shutdown(): void {
    this.bridge.off(GameBridge.SNAPSHOT, this.receiveSnapshot, this);
    this.input.off("pointerup", this.handlePointer, this);
  }

  private receiveSnapshot(
    snapshot: MatchSnapshot,
    localPlayerId: string,
  ): void {
    const selectedUnit = snapshot.units.find(
      (unit) => unit.id === this.selectedUnitId,
    );
    if (!selectedUnit || snapshot.activePlayerId !== localPlayerId) {
      this.selectedUnitId = "";
    }
    this.snapshot = snapshot;
    this.localPlayerId = localPlayerId;
    this.renderBoard();
  }

  private handlePointer(pointer: Phaser.Input.Pointer): void {
    if (!this.snapshot || this.snapshot.status !== "playing") {
      return;
    }

    const x = Math.floor((pointer.x - BOARD_PADDING) / TILE_SIZE);
    const y = Math.floor((pointer.y - BOARD_PADDING) / TILE_SIZE);
    if (
      x < 0 ||
      y < 0 ||
      x >= this.snapshot.boardWidth ||
      y >= this.snapshot.boardHeight
    ) {
      return;
    }

    const clickedUnit = this.snapshot.units.find(
      (unit) => unit.x === x && unit.y === y,
    );
    if (clickedUnit?.ownerId === this.localPlayerId) {
      this.selectedUnitId = clickedUnit.id;
      this.renderBoard();
      return;
    }

    if (this.selectedUnitId) {
      this.bridge.selectTile({ x, y });
    }
  }

  private renderBoard(): void {
    if (!this.graphics) {
      return;
    }
    this.graphics.clear();
    this.labels.forEach((label) => label.destroy());
    this.labels = [];

    this.drawBackdrop();
    if (!this.snapshot) {
      return;
    }

    const selectedUnit = this.snapshot.units.find(
      (unit) => unit.id === this.selectedUnitId,
    );

    for (const tile of this.snapshot.tiles) {
      const left = BOARD_PADDING + tile.x * TILE_SIZE;
      const top = BOARD_PADDING + tile.y * TILE_SIZE;
      const isReachable = selectedUnit
        ? this.isReachable(tile.x, tile.y, selectedUnit)
        : false;
      const color = tile.walkable ? 0x151f2f : 0x29364a;

      this.graphics.fillStyle(isReachable ? 0x173f42 : color, 1);
      this.graphics.fillRoundedRect(left + 3, top + 3, TILE_SIZE - 6, TILE_SIZE - 6, 8);
      this.graphics.lineStyle(1, isReachable ? 0x47e5c1 : 0x2c3a50, 0.8);
      this.graphics.strokeRoundedRect(left + 3, top + 3, TILE_SIZE - 6, TILE_SIZE - 6, 8);

      if (!tile.walkable) {
        this.graphics.fillStyle(0x607089, 0.55);
        this.graphics.fillRect(left + 20, top + 20, TILE_SIZE - 40, TILE_SIZE - 40);
        this.graphics.lineStyle(2, 0x8190a5, 0.7);
        this.graphics.lineBetween(left + 21, top + 21, left + TILE_SIZE - 21, top + TILE_SIZE - 21);
        this.graphics.lineBetween(left + TILE_SIZE - 21, top + 21, left + 21, top + TILE_SIZE - 21);
      }
    }

    this.snapshot.units.forEach((unit) => this.drawUnit(unit));
  }

  private drawBackdrop(): void {
    if (!this.graphics) return;
    this.graphics.fillStyle(0x0f1724, 1);
    this.graphics.fillRoundedRect(24, 24, CANVAS_SIZE - 48, CANVAS_SIZE - 48, 24);
    this.graphics.lineStyle(1, 0x23334b, 1);
    this.graphics.strokeRoundedRect(24, 24, CANVAS_SIZE - 48, CANVAS_SIZE - 48, 24);
  }

  private drawUnit(unit: UnitSnapshot): void {
    if (!this.graphics || !this.snapshot) return;
    const player = this.snapshot.players.find((candidate) => candidate.id === unit.ownerId);
    const isLocal = unit.ownerId === this.localPlayerId;
    const isSelected = unit.id === this.selectedUnitId;
    const centerX = BOARD_PADDING + unit.x * TILE_SIZE + TILE_SIZE / 2;
    const centerY = BOARD_PADDING + unit.y * TILE_SIZE + TILE_SIZE / 2;
    const unitColor = player?.slot === 0 ? 0x47e5c1 : 0xff6b7a;

    if (isSelected) {
      this.graphics.lineStyle(4, 0xffffff, 0.95);
      this.graphics.strokeCircle(centerX, centerY, TILE_SIZE * 0.35);
    }
    this.graphics.fillStyle(unitColor, 0.18);
    this.graphics.fillCircle(centerX, centerY, TILE_SIZE * 0.34);
    this.graphics.fillStyle(unitColor, 1);
    this.graphics.fillCircle(centerX, centerY, TILE_SIZE * 0.24);
    this.graphics.lineStyle(3, isLocal ? 0xeafffa : 0x2a1015, 0.9);
    this.graphics.strokeCircle(centerX, centerY, TILE_SIZE * 0.24);

    const label = this.add
      .text(centerX, centerY, player?.displayName.slice(0, 2).toUpperCase() ?? "?", {
        color: player?.slot === 0 ? "#071b18" : "#28080d",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "18px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.labels.push(label);
  }

  private isReachable(x: number, y: number, unit: UnitSnapshot): boolean {
    if (!this.snapshot || this.snapshot.activePlayerId !== this.localPlayerId) {
      return false;
    }
    const tile = this.snapshot.tiles.find(
      (candidate) => candidate.x === x && candidate.y === y,
    );
    const occupied = this.snapshot.units.some(
      (candidate) => candidate.x === x && candidate.y === y,
    );
    return Boolean(
      tile?.walkable &&
        !occupied &&
        manhattanDistance(unit, { x, y }) <= GAME_CONFIG.phaseOne.moveDistance,
    );
  }
}

