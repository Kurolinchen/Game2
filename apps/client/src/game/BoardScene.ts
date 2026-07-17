import Phaser from "phaser";
import {
  ABILITY_DEFINITIONS,
  GAME_CONFIG,
  findReachableTiles,
  hasLineOfSight,
  manhattanDistance,
  positionKey,
  validateAttack,
  type AttackTile,
} from "@tactics-lite/game-core";
import {
  GameBridge,
  type BoardInteractionContext,
} from "./GameBridge";
import type {
  MatchSnapshot,
  UnitSnapshot,
} from "../multiplayer/types";

const CANVAS_SIZE = 720;
const BOARD_PADDING = 56;
const TILE_SIZE = (CANVAS_SIZE - BOARD_PADDING * 2) / GAME_CONFIG.board.width;

export class BoardScene extends Phaser.Scene {
  private bridge: GameBridge;
  private snapshot?: MatchSnapshot;
  private localPlayerId = "";
  private interaction: BoardInteractionContext = {
    selectedUnitId: "",
    actionMode: "move",
  };
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
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);

    // React can publish the initial snapshot before Phaser has finished creating
    // this scene. Replay the retained value so the board never starts empty.
    if (!this.bridge.replayLatestSnapshot()) {
      this.renderBoard();
    }
  }

  private shutdown(): void {
    this.bridge.off(GameBridge.SNAPSHOT, this.receiveSnapshot, this);
    this.input.off("pointerup", this.handlePointer, this);
  }

  private receiveSnapshot(
    snapshot: MatchSnapshot,
    localPlayerId: string,
    interaction: BoardInteractionContext,
  ): void {
    this.snapshot = snapshot;
    this.localPlayerId = localPlayerId;
    this.interaction = interaction;
    this.renderBoard();
  }

  private handlePointer(pointer: Phaser.Input.Pointer): void {
    if (!this.snapshot) return;

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
      (unit) => unit.alive && unit.x === x && unit.y === y,
    );
    if (clickedUnit) {
      this.bridge.select({ type: "unit", unitId: clickedUnit.id });
    } else {
      this.bridge.select({ type: "tile", x, y });
    }
  }

  private renderBoard(): void {
    if (!this.graphics) return;
    this.graphics.clear();
    this.labels.forEach((label) => label.destroy());
    this.labels = [];

    this.drawBackdrop();
    if (!this.snapshot) return;

    const selectedUnit = this.snapshot.units.find(
      (unit) => unit.id === this.interaction.selectedUnitId && unit.alive,
    );
    const reachable = this.targetTileKeys(selectedUnit);
    const validTargets = this.validUnitTargets(selectedUnit);

    for (const tile of this.snapshot.tiles) {
      const left = BOARD_PADDING + tile.x * TILE_SIZE;
      const top = BOARD_PADDING + tile.y * TILE_SIZE;
      const tileKey = positionKey(tile);
      const isReachable = reachable.has(tileKey);
      const color = tile.tileType === "floor" ? 0x151f2f : 0x29364a;

      this.graphics.fillStyle(isReachable ? 0x173f42 : color, 1);
      this.graphics.fillRoundedRect(
        left + 3,
        top + 3,
        TILE_SIZE - 6,
        TILE_SIZE - 6,
        8,
      );
      this.graphics.lineStyle(
        isReachable ? 2 : 1,
        isReachable ? 0x47e5c1 : 0x2c3a50,
        0.85,
      );
      this.graphics.strokeRoundedRect(
        left + 3,
        top + 3,
        TILE_SIZE - 6,
        TILE_SIZE - 6,
        8,
      );

      if (tile.tileType === "obstacle") this.drawObstacle(left, top);
      if (tile.tileType === "cover") this.drawCover(left, top);
      if (isReachable) {
        this.graphics.fillStyle(0x47e5c1, 0.75);
        this.graphics.fillCircle(
          left + TILE_SIZE / 2,
          top + TILE_SIZE / 2,
          4,
        );
      }
    }

    this.snapshot.units
      .filter((unit) => !unit.alive)
      .forEach((unit) => this.drawEliminatedUnit(unit));
    this.snapshot.units
      .filter((unit) => unit.alive)
      .forEach((unit) =>
        this.drawUnit(unit, validTargets.has(unit.id)),
      );
  }

  private drawBackdrop(): void {
    if (!this.graphics) return;
    this.graphics.fillStyle(0x0f1724, 1);
    this.graphics.fillRoundedRect(
      24,
      24,
      CANVAS_SIZE - 48,
      CANVAS_SIZE - 48,
      24,
    );
    this.graphics.lineStyle(1, 0x23334b, 1);
    this.graphics.strokeRoundedRect(
      24,
      24,
      CANVAS_SIZE - 48,
      CANVAS_SIZE - 48,
      24,
    );
  }

  private drawObstacle(left: number, top: number): void {
    if (!this.graphics) return;
    this.graphics.fillStyle(0x607089, 0.6);
    this.graphics.fillRect(
      left + 16,
      top + 13,
      TILE_SIZE - 32,
      TILE_SIZE - 26,
    );
    this.graphics.lineStyle(2, 0x93a0b4, 0.7);
    this.graphics.lineBetween(
      left + 18,
      top + 15,
      left + TILE_SIZE - 18,
      top + TILE_SIZE - 15,
    );
    this.graphics.lineBetween(
      left + TILE_SIZE - 18,
      top + 15,
      left + 18,
      top + TILE_SIZE - 15,
    );
  }

  private drawCover(left: number, top: number): void {
    if (!this.graphics) return;
    this.graphics.fillStyle(0xa36f3e, 0.82);
    this.graphics.fillRoundedRect(
      left + 13,
      top + TILE_SIZE * 0.47,
      TILE_SIZE - 26,
      TILE_SIZE * 0.3,
      5,
    );
    this.graphics.lineStyle(2, 0xd09a5e, 0.7);
    this.graphics.strokeRoundedRect(
      left + 13,
      top + TILE_SIZE * 0.47,
      TILE_SIZE - 26,
      TILE_SIZE * 0.3,
      5,
    );
  }

  private drawUnit(unit: UnitSnapshot, isValidTarget: boolean): void {
    if (!this.graphics || !this.snapshot) return;
    const player = this.snapshot.players.find(
      (candidate) => candidate.id === unit.ownerId,
    );
    const isLocal = unit.ownerId === this.localPlayerId;
    const isSelected = unit.id === this.interaction.selectedUnitId;
    const centerX = BOARD_PADDING + unit.x * TILE_SIZE + TILE_SIZE / 2;
    const centerY = BOARD_PADDING + unit.y * TILE_SIZE + TILE_SIZE / 2;
    const unitColor = player?.slot === 0 ? 0x47e5c1 : 0xff6b7a;

    if (isValidTarget) {
      this.graphics.lineStyle(5, 0xffc45c, 0.95);
      this.graphics.strokeCircle(centerX, centerY, TILE_SIZE * 0.39);
    } else if (isSelected) {
      this.graphics.lineStyle(4, 0xffffff, 0.95);
      this.graphics.strokeCircle(centerX, centerY, TILE_SIZE * 0.36);
    }
    if (unit.overwatchActive) {
      this.graphics.lineStyle(2, 0x6ea8ff, 0.9);
      this.graphics.strokeCircle(centerX, centerY, TILE_SIZE * 0.43);
    }
    this.graphics.fillStyle(unitColor, 0.18);
    this.graphics.fillCircle(centerX, centerY, TILE_SIZE * 0.34);
    this.graphics.fillStyle(unitColor, unit.isDecoy ? 0.45 : 1);
    if (unit.isDecoy) {
      this.graphics.fillRoundedRect(
        centerX - TILE_SIZE * 0.21,
        centerY - TILE_SIZE * 0.21,
        TILE_SIZE * 0.42,
        TILE_SIZE * 0.42,
        8,
      );
    } else {
      this.graphics.fillCircle(centerX, centerY, TILE_SIZE * 0.24);
    }
    this.graphics.lineStyle(3, isLocal ? 0xeafffa : 0x2a1015, 0.9);
    this.graphics.strokeCircle(centerX, centerY, TILE_SIZE * 0.24);

    const hpRatio = unit.hp / unit.maxHp;
    this.graphics.fillStyle(0x0a0f18, 0.95);
    this.graphics.fillRoundedRect(
      centerX - TILE_SIZE * 0.3,
      centerY + TILE_SIZE * 0.29,
      TILE_SIZE * 0.6,
      7,
      3,
    );
    this.graphics.fillStyle(hpRatio > 0.4 ? 0x73e0a1 : 0xff6b7a, 1);
    this.graphics.fillRoundedRect(
      centerX - TILE_SIZE * 0.3 + 1,
      centerY + TILE_SIZE * 0.29 + 1,
      (TILE_SIZE * 0.6 - 2) * hpRatio,
      5,
      2,
    );

    const label = this.add
      .text(centerX, centerY - 1, unit.name.slice(0, 1), {
        color: player?.slot === 0 ? "#071b18" : "#28080d",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "20px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.labels.push(label);
  }

  private drawEliminatedUnit(unit: UnitSnapshot): void {
    if (!this.graphics) return;
    const centerX = BOARD_PADDING + unit.x * TILE_SIZE + TILE_SIZE / 2;
    const centerY = BOARD_PADDING + unit.y * TILE_SIZE + TILE_SIZE / 2;
    this.graphics.lineStyle(4, 0x7d8798, 0.28);
    this.graphics.lineBetween(
      centerX - 12,
      centerY - 12,
      centerX + 12,
      centerY + 12,
    );
    this.graphics.lineBetween(
      centerX + 12,
      centerY - 12,
      centerX - 12,
      centerY + 12,
    );
  }

  private targetTileKeys(selectedUnit?: UnitSnapshot): Set<string> {
    if (
      !this.snapshot ||
      !selectedUnit ||
      selectedUnit.ownerId !== this.localPlayerId ||
      this.snapshot.activePlayerId !== this.localPlayerId ||
      selectedUnit.isDecoy
    ) {
      return new Set();
    }

    const mode = this.interaction.actionMode;
    if (mode === "breach") {
      if (
        selectedUnit.classId !== "breacher" ||
        this.snapshot.actionPointsRemaining <
          ABILITY_DEFINITIONS.breach.actionPointCost
      ) {
        return new Set();
      }
      return new Set(
        this.snapshot.tiles
          .filter(
            (tile) =>
              tile.tileType === "cover" &&
              manhattanDistance(selectedUnit, tile) === 1,
          )
          .map(positionKey),
      );
    }

    if (mode === "decoy") {
      if (
        selectedUnit.classId !== "trickster" ||
        this.snapshot.actionPointsRemaining <
          ABILITY_DEFINITIONS.decoy.actionPointCost
      ) {
        return new Set();
      }
      const occupied = new Set(
        this.snapshot.units.filter((unit) => unit.alive).map(positionKey),
      );
      const tiles = this.attackTiles();
      return new Set(
        this.snapshot.tiles
          .filter(
            (tile) =>
              tile.walkable &&
              !occupied.has(positionKey(tile)) &&
              manhattanDistance(selectedUnit, tile) <=
                ABILITY_DEFINITIONS.decoy.range &&
              hasLineOfSight(selectedUnit, tile, tiles),
          )
          .map(positionKey),
      );
    }

    if (mode !== "move") return new Set();

    const blocked = this.snapshot.tiles
      .filter((tile) => !tile.walkable)
      .map((tile) => ({ x: tile.x, y: tile.y }));
    const occupied = this.snapshot.units
      .filter((unit) => unit.alive && unit.id !== selectedUnit.id)
      .map((unit) => ({ x: unit.x, y: unit.y }));
    return new Set(
      findReachableTiles(
        selectedUnit,
        this.snapshot.boardWidth,
        this.snapshot.boardHeight,
        blocked,
        occupied,
        selectedUnit.movementRange,
        this.snapshot.actionPointsRemaining,
        GAME_CONFIG.actions.movementCostPerTile,
        selectedUnit.movementDiscountAvailable ? 1 : 0,
      ).map(positionKey),
    );
  }

  private validUnitTargets(selectedUnit?: UnitSnapshot): Set<string> {
    if (
      !this.snapshot ||
      !selectedUnit ||
      selectedUnit.ownerId !== this.localPlayerId ||
      this.snapshot.activePlayerId !== this.localPlayerId ||
      selectedUnit.isDecoy
    ) {
      return new Set();
    }
    const tiles = this.attackTiles();
    const mode = this.interaction.actionMode;
    if (mode === "kinetic-push") {
      return new Set(
        this.snapshot.units
          .filter(
            (unit) =>
              unit.alive &&
              unit.ownerId !== this.localPlayerId &&
              selectedUnit.classId === "breacher" &&
              manhattanDistance(selectedUnit, unit) === 1,
          )
          .map((unit) => unit.id),
      );
    }
    if (mode === "long-shot") {
      return new Set(
        this.snapshot.units
          .filter(
            (unit) =>
              unit.alive &&
              unit.ownerId !== this.localPlayerId &&
              selectedUnit.classId === "sniper" &&
              manhattanDistance(selectedUnit, unit) <=
                ABILITY_DEFINITIONS["long-shot"].range &&
              hasLineOfSight(selectedUnit, unit, tiles),
          )
          .map((unit) => unit.id),
      );
    }
    if (mode === "swap") {
      return new Set(
        this.snapshot.units
          .filter(
            (unit) =>
              unit.alive &&
              unit.id !== selectedUnit.id &&
              selectedUnit.classId === "trickster" &&
              manhattanDistance(selectedUnit, unit) <=
                ABILITY_DEFINITIONS.swap.range,
          )
          .map((unit) => unit.id),
      );
    }
    if (mode !== "attack") return new Set();
    return new Set(
      this.snapshot.units
        .filter(
          (unit) =>
            unit.ownerId !== this.localPlayerId &&
            validateAttack({
              attacker: selectedUnit,
              target: unit,
              tiles,
              actionPointsAvailable: this.snapshot!.actionPointsRemaining,
              actionPointCost: GAME_CONFIG.actions.standardAttackCost,
            }).ok,
        )
        .map((unit) => unit.id),
    );
  }

  private attackTiles(): AttackTile[] {
    return (
      this.snapshot?.tiles.map((tile) => ({
        x: tile.x,
        y: tile.y,
        blocksLineOfSight: tile.blocksLineOfSight,
        coverValue: tile.coverValue,
      })) ?? []
    );
  }
}
