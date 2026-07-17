import Phaser from "phaser";
import {
  ABILITY_DEFINITIONS,
  GAME_CONFIG,
  calculateLongShotBaseDamage,
  calculateModifiedDamage,
  findReachableTiles,
  getCoverReduction,
  hasLineOfSight,
  manhattanDistance,
  positionKey,
  resolvePush,
  validateAttack,
  validateMovementAction,
  type AttackTile,
  type Position,
} from "@tactics-lite/game-core";
import {
  GameBridge,
  type BoardActionEvent,
  type BoardInteractionContext,
  type BoardPoint,
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
  private pulseGraphics?: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private hoveredTile?: BoardPoint;
  private touchPreviewActive = false;
  private previousSnapshot?: MatchSnapshot;
  private lastActionId = 0;

  constructor(bridge: GameBridge) {
    super({ key: "BoardScene" });
    this.bridge = bridge;
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#0b101a");
    this.graphics = this.add.graphics();
    this.pulseGraphics = this.add.graphics();
    this.input.on("pointerup", this.handlePointer, this);
    this.input.on("pointermove", this.handlePointerMove, this);
    this.input.on("gameout", this.clearHover, this);
    this.bridge.on(GameBridge.SNAPSHOT, this.receiveSnapshot, this);
    this.bridge.on(GameBridge.ACTION, this.receiveAction, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);

    // React can publish the initial snapshot before Phaser has finished creating
    // this scene. Replay the retained value so the board never starts empty.
    if (!this.bridge.replayLatestSnapshot()) {
      this.renderBoard();
    }
    this.bridge.replayLatestAction();
    this.game.canvas.dataset.boardReady = "true";
  }

  update(time: number): void {
    if (!this.pulseGraphics || !this.snapshot) return;
    this.pulseGraphics.clear();
    const selected = this.snapshot.units.find(
      (unit) => unit.id === this.interaction.selectedUnitId && unit.alive,
    );
    if (!selected || selected.ownerId !== this.localPlayerId) return;

    const center = this.tileCenter(selected);
    const pulse = (Math.sin(time / 260) + 1) / 2;
    this.pulseGraphics.lineStyle(2 + pulse * 2, 0xeffffb, 0.32 + pulse * 0.48);
    this.pulseGraphics.strokeCircle(
      center.x,
      center.y,
      TILE_SIZE * (0.37 + pulse * 0.045),
    );
  }

  private shutdown(): void {
    delete this.game.canvas.dataset.boardReady;
    this.bridge.off(GameBridge.SNAPSHOT, this.receiveSnapshot, this);
    this.bridge.off(GameBridge.ACTION, this.receiveAction, this);
    this.input.off("pointerup", this.handlePointer, this);
    this.input.off("pointermove", this.handlePointerMove, this);
    this.input.off("gameout", this.clearHover, this);
  }

  private receiveSnapshot(
    snapshot: MatchSnapshot,
    localPlayerId: string,
    interaction: BoardInteractionContext,
  ): void {
    this.previousSnapshot = this.snapshot;
    this.snapshot = snapshot;
    this.localPlayerId = localPlayerId;
    this.interaction = interaction;
    this.game.canvas.dataset.selectedUnit = interaction.selectedUnitId;
    this.renderBoard();
  }

  private receiveAction(action: BoardActionEvent): void {
    if (action.id <= this.lastActionId) return;
    this.lastActionId = action.id;
    this.animateAction(action);
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (pointer.wasTouch) return;
    const tile = this.pointerTile(pointer);
    if (
      tile?.x === this.hoveredTile?.x &&
      tile?.y === this.hoveredTile?.y
    ) {
      return;
    }
    this.hoveredTile = tile;
    this.renderBoard();
  }

  private clearHover(): void {
    // Touch previews must survive the pointer leaving after touchend so the
    // next tap on the same tile can confirm the action.
    if (this.touchPreviewActive) return;
    if (!this.hoveredTile) return;
    this.hoveredTile = undefined;
    this.touchPreviewActive = false;
    this.renderBoard();
  }

  private handlePointer(pointer: Phaser.Input.Pointer): void {
    if (!this.snapshot) return;
    const tile = this.pointerTile(pointer);
    if (!tile) return;
    const { x, y } = tile;

    const clickedUnit = this.snapshot.units.find(
      (unit) => unit.alive && unit.x === x && unit.y === y,
    );
    const isOwnSelectableUnit =
      clickedUnit?.ownerId === this.localPlayerId && !clickedUnit.isDecoy;
    if (pointer.wasTouch && !isOwnSelectableUnit) {
      const confirmsPreview =
        this.hoveredTile?.x === x && this.hoveredTile?.y === y;
      if (!confirmsPreview) {
        this.hoveredTile = tile;
        this.touchPreviewActive = true;
        this.renderBoard();
        return;
      }
    }
    this.touchPreviewActive = false;
    this.hoveredTile = undefined;
    if (clickedUnit) {
      this.bridge.select({ type: "unit", unitId: clickedUnit.id });
    } else {
      this.bridge.select({ type: "tile", x, y });
    }
  }

  private pointerTile(pointer: Phaser.Input.Pointer): BoardPoint | undefined {
    if (!this.snapshot) return undefined;
    const x = Math.floor((pointer.x - BOARD_PADDING) / TILE_SIZE);
    const y = Math.floor((pointer.y - BOARD_PADDING) / TILE_SIZE);
    return x >= 0 &&
      y >= 0 &&
      x < this.snapshot.boardWidth &&
      y < this.snapshot.boardHeight
      ? { x, y }
      : undefined;
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
    const rangeTiles = this.actionRangeTileKeys(selectedUnit);
    const validTargets = this.validUnitTargets(selectedUnit);
    const highlightColor = this.actionHighlightColor();

    for (const tile of this.snapshot.tiles) {
      const left = BOARD_PADDING + tile.x * TILE_SIZE;
      const top = BOARD_PADDING + tile.y * TILE_SIZE;
      const tileKey = positionKey(tile);
      const isReachable = reachable.has(tileKey);
      const isInRange = rangeTiles.has(tileKey);
      const isHovered = tileKey === positionKey(this.hoveredTile ?? { x: -1, y: -1 });
      const floorColors = [0x141e2d, 0x172231, 0x121c2a, 0x182433];
      const color =
        tile.tileType === "floor"
          ? floorColors[(tile.x * 3 + tile.y * 5) % floorColors.length]!
          : 0x29364a;

      this.graphics.fillStyle(
        isReachable
          ? this.highlightFillColor()
          : isInRange
            ? this.rangeFillColor()
            : color,
        1,
      );
      this.graphics.fillRoundedRect(
        left + 3,
        top + 3,
        TILE_SIZE - 6,
        TILE_SIZE - 6,
        8,
      );
      this.graphics.lineStyle(
        isHovered ? 3 : isReachable ? 2 : 1,
        isHovered ? 0xffffff : isReachable ? highlightColor : 0x2c3a50,
        isHovered ? 0.9 : 0.85,
      );
      this.graphics.strokeRoundedRect(
        left + 3,
        top + 3,
        TILE_SIZE - 6,
        TILE_SIZE - 6,
        8,
      );

      if (tile.tileType === "floor") this.drawFloorDetails(tile.x, tile.y, left, top);
      if (tile.tileType === "obstacle") this.drawObstacle(left, top);
      if (tile.tileType === "cover") this.drawCover(left, top);
      if (isReachable) {
        this.graphics.fillStyle(highlightColor, 0.8);
        this.graphics.fillCircle(
          left + TILE_SIZE / 2,
          top + TILE_SIZE / 2,
          4,
        );
      }
    }

    this.drawHoverPreview(selectedUnit, reachable, validTargets);

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
    this.graphics.lineStyle(3, 0x47e5c1, 0.18);
    this.graphics.lineBetween(58, 42, CANVAS_SIZE - 58, 42);
    this.graphics.lineStyle(3, 0xff6b7a, 0.15);
    this.graphics.lineBetween(58, CANVAS_SIZE - 42, CANVAS_SIZE - 58, CANVAS_SIZE - 42);
  }

  private drawFloorDetails(
    x: number,
    y: number,
    left: number,
    top: number,
  ): void {
    if (!this.graphics) return;
    const variant = (x * 7 + y * 11) % 9;
    if (variant === 0 || variant === 5) {
      this.graphics.lineStyle(2, 0x6c7d94, 0.12);
      this.graphics.lineBetween(left + 15, top + 15, left + TILE_SIZE - 15, top + 15);
      this.graphics.lineBetween(left + 15, top + 20, left + TILE_SIZE - 26, top + 20);
    }
    if (variant === 2) {
      this.graphics.lineStyle(3, 0xeac866, 0.18);
      for (let offset = 13; offset < TILE_SIZE - 12; offset += 12) {
        this.graphics.lineBetween(
          left + offset,
          top + TILE_SIZE - 13,
          left + offset + 7,
          top + TILE_SIZE - 20,
        );
      }
    }
    if (variant === 7) {
      this.graphics.lineStyle(2, 0x263a50, 0.65);
      this.graphics.strokeCircle(left + TILE_SIZE * 0.72, top + TILE_SIZE * 0.28, 8);
      this.graphics.lineBetween(
        left + TILE_SIZE * 0.72,
        top + TILE_SIZE * 0.2,
        left + TILE_SIZE * 0.72,
        top + TILE_SIZE * 0.36,
      );
    }
  }

  private drawObstacle(left: number, top: number): void {
    if (!this.graphics) return;
    this.graphics.fillStyle(0x05080d, 0.42);
    this.graphics.fillRoundedRect(
      left + 19,
      top + 20,
      TILE_SIZE - 30,
      TILE_SIZE - 24,
      5,
    );
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
    this.graphics.fillStyle(0x05080d, 0.4);
    this.graphics.fillRoundedRect(
      left + 15,
      top + TILE_SIZE * 0.55,
      TILE_SIZE - 22,
      TILE_SIZE * 0.32,
      5,
    );
    this.graphics.fillStyle(0xa36f3e, 0.82);
    this.graphics.fillRoundedRect(
      left + 13,
      top + TILE_SIZE * 0.37,
      TILE_SIZE - 26,
      TILE_SIZE * 0.4,
      5,
    );
    this.graphics.lineStyle(2, 0xd09a5e, 0.7);
    this.graphics.strokeRoundedRect(
      left + 13,
      top + TILE_SIZE * 0.37,
      TILE_SIZE - 26,
      TILE_SIZE * 0.4,
      5,
    );
    this.graphics.lineStyle(2, 0x5d3b25, 0.7);
    this.graphics.lineBetween(
      left + TILE_SIZE * 0.5,
      top + TILE_SIZE * 0.39,
      left + TILE_SIZE * 0.5,
      top + TILE_SIZE * 0.75,
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

    this.graphics.fillStyle(0x02050a, 0.5);
    this.graphics.fillEllipse(
      centerX + 3,
      centerY + TILE_SIZE * 0.22,
      TILE_SIZE * 0.62,
      TILE_SIZE * 0.24,
    );
    this.graphics.lineStyle(3, unitColor, 0.78);
    this.graphics.strokeEllipse(
      centerX,
      centerY + TILE_SIZE * 0.21,
      TILE_SIZE * 0.64,
      TILE_SIZE * 0.25,
    );

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
    this.graphics.fillStyle(unitColor, 0.13);
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
      this.graphics.lineStyle(2, 0xffffff, 0.35);
      this.graphics.strokeRoundedRect(
        centerX - TILE_SIZE * 0.17,
        centerY - TILE_SIZE * 0.27,
        TILE_SIZE * 0.42,
        TILE_SIZE * 0.42,
        8,
      );
    } else if (unit.classId === "breacher") {
      this.graphics.fillRoundedRect(
        centerX - TILE_SIZE * 0.28,
        centerY - TILE_SIZE * 0.22,
        TILE_SIZE * 0.56,
        TILE_SIZE * 0.45,
        10,
      );
      this.graphics.fillTriangle(
        centerX - TILE_SIZE * 0.31,
        centerY - TILE_SIZE * 0.05,
        centerX - TILE_SIZE * 0.19,
        centerY - TILE_SIZE * 0.29,
        centerX - TILE_SIZE * 0.12,
        centerY + TILE_SIZE * 0.06,
      );
      this.graphics.fillTriangle(
        centerX + TILE_SIZE * 0.31,
        centerY - TILE_SIZE * 0.05,
        centerX + TILE_SIZE * 0.19,
        centerY - TILE_SIZE * 0.29,
        centerX + TILE_SIZE * 0.12,
        centerY + TILE_SIZE * 0.06,
      );
    } else if (unit.classId === "sniper") {
      this.graphics.fillTriangle(
        centerX,
        centerY - TILE_SIZE * 0.32,
        centerX - TILE_SIZE * 0.2,
        centerY + TILE_SIZE * 0.27,
        centerX + TILE_SIZE * 0.2,
        centerY + TILE_SIZE * 0.27,
      );
      this.graphics.fillRect(
        centerX + TILE_SIZE * 0.12,
        centerY - TILE_SIZE * 0.22,
        TILE_SIZE * 0.25,
        4,
      );
    } else {
      this.graphics.fillTriangle(
        centerX - TILE_SIZE * 0.27,
        centerY + TILE_SIZE * 0.22,
        centerX - TILE_SIZE * 0.06,
        centerY - TILE_SIZE * 0.3,
        centerX + TILE_SIZE * 0.15,
        centerY + TILE_SIZE * 0.2,
      );
      this.graphics.fillCircle(
        centerX + TILE_SIZE * 0.18,
        centerY - TILE_SIZE * 0.08,
        TILE_SIZE * 0.13,
      );
    }
    this.graphics.lineStyle(3, isLocal ? 0xeafffa : 0x2a1015, 0.86);
    if (unit.classId === "breacher") {
      this.graphics.strokeRoundedRect(
        centerX - TILE_SIZE * 0.28,
        centerY - TILE_SIZE * 0.22,
        TILE_SIZE * 0.56,
        TILE_SIZE * 0.45,
        10,
      );
    } else {
      this.graphics.strokeCircle(centerX, centerY, TILE_SIZE * 0.26);
    }

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
      .text(centerX, centerY - 1, this.classGlyph(unit.classId), {
        color: player?.slot === 0 ? "#071b18" : "#28080d",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: unit.classId === "breacher" ? "17px" : "20px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.labels.push(label);
  }

  private drawHoverPreview(
    selectedUnit: UnitSnapshot | undefined,
    reachable: ReadonlySet<string>,
    validTargets: ReadonlySet<string>,
  ): void {
    if (
      !this.graphics ||
      !this.snapshot ||
      !selectedUnit ||
      !this.hoveredTile ||
      selectedUnit.ownerId !== this.localPlayerId ||
      this.snapshot.activePlayerId !== this.localPlayerId
    ) {
      return;
    }

    const hoverKey = positionKey(this.hoveredTile);
    const hoveredUnit = this.snapshot.units.find(
      (unit) =>
        unit.alive &&
        unit.x === this.hoveredTile?.x &&
        unit.y === this.hoveredTile?.y,
    );

    if (this.interaction.actionMode === "move" && reachable.has(hoverKey)) {
      const validation = this.movementPreview(selectedUnit, this.hoveredTile);
      if (validation.ok) {
        const points = [selectedUnit, ...validation.path];
        this.graphics.lineStyle(5, 0x47e5c1, 0.82);
        this.graphics.beginPath();
        const start = this.tileCenter(points[0]!);
        this.graphics.moveTo(start.x, start.y);
        for (const point of points.slice(1)) {
          const center = this.tileCenter(point);
          this.graphics.lineTo(center.x, center.y);
        }
        this.graphics.strokePath();
        for (const point of validation.path) {
          const center = this.tileCenter(point);
          this.graphics.fillStyle(0xeafffa, 0.92);
          this.graphics.fillCircle(center.x, center.y, 4);
        }
        this.addPreviewLabel(
          this.hoveredTile,
          `${validation.cost} AP`,
          "#47e5c1",
        );
      }
      return;
    }

    if (hoveredUnit && validTargets.has(hoveredUnit.id)) {
      this.drawUnitTargetPreview(selectedUnit, hoveredUnit);
      return;
    }

    if (
      reachable.has(hoverKey) &&
      this.interaction.actionMode !== "move" &&
      this.interaction.actionMode !== "attack"
    ) {
      const ability = ABILITY_DEFINITIONS[this.interaction.actionMode];
      this.addPreviewLabel(
        this.hoveredTile,
        `${ability.actionPointCost} AP · ${ability.name}`,
        "#c390ff",
      );
    }
  }

  private movementPreview(selectedUnit: UnitSnapshot, target: Position) {
    if (!this.snapshot) return { ok: false as const, reason: "unreachable" as const };
    const blocked = this.snapshot.tiles
      .filter((tile) => !tile.walkable)
      .map(({ x, y }) => ({ x, y }));
    const occupied = this.snapshot.units
      .filter((unit) => unit.alive && unit.id !== selectedUnit.id)
      .map(({ x, y }) => ({ x, y }));
    return validateMovementAction({
      from: selectedUnit,
      to: target,
      boardWidth: this.snapshot.boardWidth,
      boardHeight: this.snapshot.boardHeight,
      blocked,
      occupied,
      maxDistance: selectedUnit.movementRange,
      actionPointsAvailable: this.snapshot.actionPointsRemaining,
      actionPointCostPerTile: GAME_CONFIG.actions.movementCostPerTile,
      actionPointDiscount: selectedUnit.movementDiscountAvailable ? 1 : 0,
    });
  }

  private drawUnitTargetPreview(
    selectedUnit: UnitSnapshot,
    target: UnitSnapshot,
  ): void {
    if (!this.graphics || !this.snapshot) return;
    const mode = this.interaction.actionMode;
    const from = this.tileCenter(selectedUnit);
    const to = this.tileCenter(target);
    let label = "TARGET";
    let color = 0xffc45c;

    if (mode === "attack") {
      const validation = validateAttack({
        attacker: selectedUnit,
        target,
        tiles: this.attackTiles(),
        actionPointsAvailable: this.snapshot.actionPointsRemaining,
        actionPointCost: GAME_CONFIG.actions.standardAttackCost,
      });
      if (!validation.ok) return;
      label = `−${validation.damage} HP · ${validation.coverReduction > 0 ? `cover −${validation.coverReduction}` : "clear shot"}`;
    } else if (mode === "long-shot") {
      const distance = manhattanDistance(selectedUnit, target);
      const coverReduction = getCoverReduction(
        selectedUnit,
        target,
        this.attackTiles(),
      );
      const result = calculateModifiedDamage(
        calculateLongShotBaseDamage(distance),
        distance,
        "sniper",
        target.classId,
        coverReduction,
      );
      label = `−${result.damage} HP · ${coverReduction > 0 ? `cover −${coverReduction}` : "clear shot"}`;
      color = 0x6ea8ff;
    } else if (mode === "kinetic-push") {
      const push = resolvePush({
        attacker: selectedUnit,
        target,
        boardWidth: this.snapshot.boardWidth,
        boardHeight: this.snapshot.boardHeight,
        blocked: this.snapshot.tiles
          .filter((tile) => !tile.walkable)
          .map(({ x, y }) => ({ x, y })),
        occupied: this.snapshot.units
          .filter(
            (unit) =>
              unit.alive &&
              unit.id !== target.id &&
              unit.id !== selectedUnit.id,
          )
          .map(({ x, y }) => ({ x, y })),
      });
      const damage = calculateModifiedDamage(
        GAME_CONFIG.actions.pushDamage +
          (push?.collided ? GAME_CONFIG.actions.pushCollisionDamage : 0),
        1,
        "breacher",
        target.classId,
      ).damage;
      label = `PUSH · −${damage} HP${push?.collided ? " · collision" : ""}`;
      color = 0xc390ff;
    } else if (mode === "swap") {
      label = `${ABILITY_DEFINITIONS.swap.actionPointCost} AP · SWAP`;
      color = 0xc390ff;
    }

    this.graphics.lineStyle(mode === "long-shot" ? 4 : 3, color, 0.88);
    this.graphics.lineBetween(from.x, from.y, to.x, to.y);
    const steps = Math.max(4, Math.floor(manhattanDistance(selectedUnit, target) * 3));
    for (let index = 1; index < steps; index += 1) {
      const progress = index / steps;
      this.graphics.fillStyle(color, index % 2 === 0 ? 0.95 : 0.35);
      this.graphics.fillCircle(
        Phaser.Math.Linear(from.x, to.x, progress),
        Phaser.Math.Linear(from.y, to.y, progress),
        mode === "long-shot" ? 3 : 2,
      );
    }
    this.graphics.lineStyle(2, color, 1);
    this.graphics.strokeCircle(to.x, to.y, TILE_SIZE * 0.3);
    this.graphics.lineBetween(to.x - 10, to.y, to.x + 10, to.y);
    this.graphics.lineBetween(to.x, to.y - 10, to.x, to.y + 10);
    this.addPreviewLabel(target, label, `#${color.toString(16).padStart(6, "0")}`);
  }

  private addPreviewLabel(
    target: Position,
    text: string,
    color: string,
  ): void {
    const center = this.tileCenter(target);
    const displayText = this.touchPreviewActive ? `${text} · TAP AGAIN` : text;
    const label = this.add
      .text(center.x, center.y - TILE_SIZE * 0.34, displayText, {
        color,
        backgroundColor: "#07101bea",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "13px",
        fontStyle: "bold",
        padding: { x: 8, y: 5 },
      })
      .setOrigin(0.5, 1);
    this.labels.push(label);
  }

  private actionRangeTileKeys(selectedUnit?: UnitSnapshot): Set<string> {
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
    const range =
      mode === "attack"
        ? selectedUnit.attackRange
        : mode === "long-shot"
          ? ABILITY_DEFINITIONS["long-shot"].range
          : mode === "kinetic-push"
            ? ABILITY_DEFINITIONS["kinetic-push"].range
            : mode === "swap"
              ? ABILITY_DEFINITIONS.swap.range
              : 0;
    if (range === 0) return new Set();
    return new Set(
      this.snapshot.tiles
        .filter((tile) => manhattanDistance(selectedUnit, tile) <= range)
        .map(positionKey),
    );
  }

  private actionHighlightColor(): number {
    const mode = this.interaction.actionMode;
    if (mode === "attack" || mode === "long-shot") return 0xffc45c;
    if (mode !== "move") return 0xc390ff;
    return 0x47e5c1;
  }

  private highlightFillColor(): number {
    const mode = this.interaction.actionMode;
    if (mode === "attack" || mode === "long-shot") return 0x3d3223;
    if (mode !== "move") return 0x302542;
    return 0x173f42;
  }

  private rangeFillColor(): number {
    const mode = this.interaction.actionMode;
    if (mode === "attack" || mode === "long-shot") return 0x26251f;
    return 0x211f2c;
  }

  private classGlyph(classId: UnitSnapshot["classId"]): string {
    if (classId === "breacher") return "⬢";
    if (classId === "sniper") return "⌖";
    if (classId === "trickster") return "◇";
    return "◈";
  }

  private tileCenter(position: Position): BoardPoint {
    return {
      x: BOARD_PADDING + position.x * TILE_SIZE + TILE_SIZE / 2,
      y: BOARD_PADDING + position.y * TILE_SIZE + TILE_SIZE / 2,
    };
  }

  private animateAction(action: BoardActionEvent): void {
    if (!this.snapshot) return;

    if (action.type === "move") {
      this.animateMovement(action);
    } else if (action.type === "attack") {
      this.animateShot(action.attackerId, action.targetId, 0xffc45c, false);
    } else if (action.type === "overwatch") {
      this.animateShot(action.unitId, action.targetId, 0x6ea8ff, true);
    } else if (action.type === "ability") {
      if (action.abilityId === "long-shot") {
        this.animateShot(action.unitId, action.targetId, 0x8dc1ff, true);
      } else if (action.abilityId === "kinetic-push") {
        this.animateShot(action.unitId, action.targetId, 0xc390ff, false);
        this.cameras.main.shake(150, action.collided ? 0.009 : 0.005);
      } else if (action.abilityId === "swap") {
        this.animateSwap(action);
      } else if (action.abilityId === "breach" && action.destroyedCover) {
        if (typeof action.x === "number" && typeof action.y === "number") {
          this.animateCoverBreak({ x: action.x, y: action.y });
        }
      } else if (action.abilityId === "decoy") {
        if (typeof action.x === "number" && typeof action.y === "number") {
          this.animateSpawn({ x: action.x, y: action.y });
        }
      }
    }

    if (action.eliminated && action.targetId) {
      const target = this.findUnitPosition(action.targetId);
      if (target) this.animateElimination(target);
    }
  }

  private animateMovement(action: BoardActionEvent): void {
    if (!action.unitId || !action.path?.length) return;
    const unit = this.snapshot?.units.find((candidate) => candidate.id === action.unitId);
    const origin =
      this.previousSnapshot?.units.find((candidate) => candidate.id === action.unitId) ??
      unit;
    if (!unit || !origin) return;

    const points = [origin, ...action.path].map((point) => this.tileCenter(point));
    if (points.length < 2) return;
    const color = this.unitColor(unit);
    const marker = this.add.container(points[0]!.x, points[0]!.y);
    const body = this.add.graphics();
    body.fillStyle(0x02060b, 0.5);
    body.fillEllipse(3, 11, TILE_SIZE * 0.48, TILE_SIZE * 0.17);
    body.fillStyle(color, 0.96);
    body.fillCircle(0, 0, TILE_SIZE * 0.2);
    body.lineStyle(3, 0xffffff, 0.78);
    body.strokeCircle(0, 0, TILE_SIZE * 0.2);
    const glyph = this.add
      .text(0, 0, this.classGlyph(unit.classId), {
        color: "#07110f",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "16px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    marker.add([body, glyph]);

    const progress = { value: 0 };
    this.tweens.add({
      targets: progress,
      value: points.length - 1,
      duration: Math.max(180, (points.length - 1) * 145),
      ease: "Sine.easeInOut",
      onUpdate: () => {
        const value = Math.min(points.length - 1, progress.value);
        const index = Math.min(points.length - 2, Math.floor(value));
        const localProgress = value - index;
        const from = points[index]!;
        const to = points[index + 1]!;
        marker.setPosition(
          Phaser.Math.Linear(from.x, to.x, localProgress),
          Phaser.Math.Linear(from.y, to.y, localProgress),
        );
      },
      onComplete: () => marker.destroy(true),
    });
  }

  private animateShot(
    sourceId: string | undefined,
    targetId: string | undefined,
    color: number,
    precisionShot: boolean,
  ): void {
    if (!sourceId || !targetId) return;
    const source = this.findUnitPosition(sourceId);
    const target = this.findUnitPosition(targetId);
    if (!source || !target) return;
    const from = this.tileCenter(source);
    const to = this.tileCenter(target);
    const beam = this.add.graphics();
    beam.lineStyle(precisionShot ? 6 : 4, color, 0.96);
    beam.lineBetween(from.x, from.y, to.x, to.y);
    beam.fillStyle(0xffffff, 1);
    beam.fillCircle(to.x, to.y, precisionShot ? 7 : 5);
    this.tweens.add({
      targets: beam,
      alpha: 0,
      duration: precisionShot ? 420 : 260,
      ease: "Quad.easeOut",
      onComplete: () => beam.destroy(),
    });
    this.cameras.main.shake(precisionShot ? 150 : 95, precisionShot ? 0.006 : 0.003);
    this.spawnParticles(to, color, precisionShot ? 10 : 6);
  }

  private animateSwap(action: BoardActionEvent): void {
    if (!action.unitPosition || !action.targetPosition) return;
    const first = this.tileCenter(action.unitPosition);
    const second = this.tileCenter(action.targetPosition);
    const effect = this.add.graphics();
    effect.lineStyle(4, 0xc390ff, 0.95);
    effect.strokeCircle(first.x, first.y, TILE_SIZE * 0.3);
    effect.strokeCircle(second.x, second.y, TILE_SIZE * 0.3);
    effect.lineBetween(first.x, first.y, second.x, second.y);
    this.tweens.add({
      targets: effect,
      alpha: 0,
      scaleX: 1.35,
      scaleY: 1.35,
      duration: 480,
      ease: "Cubic.easeOut",
      onComplete: () => effect.destroy(),
    });
    this.spawnParticles(first, 0xc390ff, 8);
    this.spawnParticles(second, 0xc390ff, 8);
  }

  private animateCoverBreak(position: Position): void {
    const center = this.tileCenter(position);
    this.cameras.main.shake(170, 0.008);
    this.spawnParticles(center, 0xd09a5e, 16);
    const ring = this.add.circle(center.x, center.y, 12, 0xd09a5e, 0);
    ring.setStrokeStyle(5, 0xf0bd7d, 0.9);
    this.tweens.add({
      targets: ring,
      scale: 3.5,
      alpha: 0,
      duration: 480,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  private animateSpawn(position: Position): void {
    const center = this.tileCenter(position);
    const ring = this.add.circle(center.x, center.y, 10, 0xc390ff, 0.15);
    ring.setStrokeStyle(4, 0xc390ff, 0.95);
    this.tweens.add({
      targets: ring,
      scale: 3,
      alpha: 0,
      duration: 620,
      ease: "Back.easeOut",
      onComplete: () => ring.destroy(),
    });
    this.spawnParticles(center, 0xc390ff, 12);
  }

  private animateElimination(position: Position): void {
    const center = this.tileCenter(position);
    const ring = this.add.circle(center.x, center.y, 13, 0xff6b7a, 0.18);
    ring.setStrokeStyle(5, 0xff8e9a, 1);
    this.tweens.add({
      targets: ring,
      scale: 4.2,
      alpha: 0,
      duration: 760,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });
    this.spawnParticles(center, 0xff6b7a, 18);
  }

  private spawnParticles(center: BoardPoint, color: number, count: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + (index % 3) * 0.14;
      const distance = 24 + (index % 5) * 7;
      const particle = this.add.rectangle(
        center.x,
        center.y,
        index % 2 === 0 ? 6 : 3,
        index % 2 === 0 ? 3 : 7,
        color,
        0.9,
      );
      this.tweens.add({
        targets: particle,
        x: center.x + Math.cos(angle) * distance,
        y: center.y + Math.sin(angle) * distance,
        angle: 120 + index * 23,
        alpha: 0,
        duration: 320 + (index % 4) * 70,
        ease: "Cubic.easeOut",
        onComplete: () => particle.destroy(),
      });
    }
  }

  private findUnitPosition(unitId: string): UnitSnapshot | undefined {
    return (
      this.snapshot?.units.find((unit) => unit.id === unitId) ??
      this.previousSnapshot?.units.find((unit) => unit.id === unitId)
    );
  }

  private unitColor(unit: UnitSnapshot): number {
    const player = this.snapshot?.players.find(
      (candidate) => candidate.id === unit.ownerId,
    );
    return player?.slot === 0 ? 0x47e5c1 : 0xff6b7a;
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
