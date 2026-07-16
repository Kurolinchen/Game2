import { Client, Room } from "colyseus";
import {
  GAME_CONFIG,
  UNIT_CLASS_ORDER,
  UNIT_DEFINITIONS,
  applyDamage,
  createWarehouseTiles,
  nextTurn,
  validateAttack,
  validateMovementAction,
  type AttackTile,
  type Position,
} from "@tactics-lite/game-core";
import { sanitizeDisplayName } from "./displayName.js";
import {
  MatchState,
  PlayerState,
  TileState,
  UnitState,
} from "./schema/MatchState.js";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_CHANNEL = "$tactics-lite-room-codes";

interface JoinOptions {
  displayName?: unknown;
}

interface MoveMessage {
  unitId?: unknown;
  x?: unknown;
  y?: unknown;
}

interface AttackMessage {
  attackerId?: unknown;
  targetId?: unknown;
}

export class TacticsRoom extends Room<{ state: MatchState }> {
  state = new MatchState();
  maxClients = GAME_CONFIG.room.maxPlayers;

  messages = {
    ready: (client: Client) => this.handleReady(client),
    move: (client: Client, payload: MoveMessage) =>
      this.handleMove(client, payload),
    attack: (client: Client, payload: AttackMessage) =>
      this.handleAttack(client, payload),
    end_turn: (client: Client) => this.handleEndTurn(client),
  };

  async onCreate(): Promise<void> {
    this.roomId = await this.reserveRoomCode();
    this.setPrivate();

    this.state.roomCode = this.roomId;
    this.state.boardWidth = GAME_CONFIG.board.width;
    this.state.boardHeight = GAME_CONFIG.board.height;
    this.state.tiles.push(
      ...createWarehouseTiles().map((tile) => TileState.fromTile(tile)),
    );
  }

  onJoin(client: Client, options: JoinOptions): void {
    const player = new PlayerState();
    player.id = client.sessionId;
    player.displayName = sanitizeDisplayName(options.displayName);
    player.slot = this.nextAvailableSlot();
    player.ready = false;
    player.connected = true;
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client): void {
    this.removePlayer(client.sessionId);
  }

  async onDispose(): Promise<void> {
    await this.presence.srem(ROOM_CODE_CHANNEL, this.roomId);
  }

  private handleReady(client: Client): void {
    if (this.state.status !== "waiting") {
      return this.reject(client, "The match has already started.");
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return this.reject(client, "Player not found in this room.");
    }

    player.ready = !player.ready;
    if (
      this.state.players.size === GAME_CONFIG.room.maxPlayers &&
      [...this.state.players.values()].every((candidate) => candidate.ready)
    ) {
      this.startMatch();
    }
  }

  private handleMove(client: Client, payload: MoveMessage): void {
    if (!this.canAct(client)) return;
    if (
      typeof payload.unitId !== "string" ||
      typeof payload.x !== "number" ||
      typeof payload.y !== "number"
    ) {
      return this.reject(client, "Invalid movement request.");
    }

    const unit = this.state.units.get(payload.unitId);
    if (!unit || unit.ownerId !== client.sessionId || !unit.alive) {
      return this.reject(client, "You do not control that active unit.");
    }

    const validation = validateMovementAction({
      from: { x: unit.x, y: unit.y },
      to: { x: payload.x, y: payload.y },
      boardWidth: this.state.boardWidth,
      boardHeight: this.state.boardHeight,
      blocked: this.blockedPositions(),
      occupied: this.occupiedPositions(unit.id),
      maxDistance: unit.movementRange,
      actionPointsAvailable: this.state.actionPointsRemaining,
      actionPointCostPerTile: GAME_CONFIG.actions.movementCostPerTile,
    });

    if (!validation.ok) {
      return this.reject(client, `Move rejected: ${validation.reason}.`);
    }

    unit.x = payload.x;
    unit.y = payload.y;
    this.state.actionPointsRemaining -= validation.cost;
    this.broadcast("action:accepted", {
      type: "move",
      unitId: unit.id,
      x: unit.x,
      y: unit.y,
      apCost: validation.cost,
      path: validation.path,
    });
    this.advanceIfOutOfActions();
  }

  private handleAttack(client: Client, payload: AttackMessage): void {
    if (!this.canAct(client)) return;
    if (
      typeof payload.attackerId !== "string" ||
      typeof payload.targetId !== "string"
    ) {
      return this.reject(client, "Invalid attack request.");
    }

    const attacker = this.state.units.get(payload.attackerId);
    const target = this.state.units.get(payload.targetId);
    if (!attacker || attacker.ownerId !== client.sessionId) {
      return this.reject(client, "You do not control that attacker.");
    }
    if (!target) return this.reject(client, "Target not found.");

    const validation = validateAttack({
      attacker,
      target,
      tiles: this.attackTiles(),
      actionPointsAvailable: this.state.actionPointsRemaining,
      actionPointCost: GAME_CONFIG.actions.standardAttackCost,
    });
    if (!validation.ok) {
      return this.reject(client, `Attack rejected: ${validation.reason}.`);
    }

    const outcome = applyDamage(target.hp, validation.damage);
    target.hp = outcome.hp;
    target.alive = outcome.alive;
    this.state.actionPointsRemaining -= validation.cost;

    this.broadcast("action:accepted", {
      type: "attack",
      attackerId: attacker.id,
      targetId: target.id,
      damage: validation.damage,
      coverReduction: validation.coverReduction,
      remainingHp: target.hp,
      eliminated: !target.alive,
      apCost: validation.cost,
    });

    if (this.checkVictory(attacker.ownerId)) return;
    this.advanceIfOutOfActions();
  }

  private canAct(client: Client): boolean {
    if (this.state.status !== "playing") {
      this.reject(client, "The match is not running.");
      return false;
    }
    if (this.state.activePlayerId !== client.sessionId) {
      this.reject(client, "It is not your turn.");
      return false;
    }
    if (this.state.actionPointsRemaining <= 0) {
      this.reject(client, "No action points remain this turn.");
      return false;
    }
    return true;
  }

  private handleEndTurn(client: Client): void {
    if (
      this.state.status !== "playing" ||
      this.state.activePlayerId !== client.sessionId
    ) {
      return this.reject(client, "Only the active player can end the turn.");
    }
    this.advanceTurn();
  }

  private startMatch(): void {
    const players = this.orderedPlayers();
    if (players.length !== GAME_CONFIG.room.maxPlayers) return;

    this.state.units.clear();
    players.forEach((player) => {
      UNIT_CLASS_ORDER.forEach((classId, classIndex) => {
        const spawn = GAME_CONFIG.spawnPoints[player.slot]?.[classIndex];
        if (!spawn) {
          throw new Error(
            `Missing spawn point for player ${player.slot}, unit ${classIndex}.`,
          );
        }
        const definition = UNIT_DEFINITIONS[classId];
        const unit = new UnitState();
        unit.id = `${player.id}-${classId}`;
        unit.ownerId = player.id;
        unit.classId = definition.classId;
        unit.name = definition.name;
        unit.x = spawn.x;
        unit.y = spawn.y;
        unit.hp = definition.maxHp;
        unit.maxHp = definition.maxHp;
        unit.movementRange = definition.movementRange;
        unit.attackRange = definition.attackRange;
        unit.attackDamage = definition.attackDamage;
        unit.alive = true;
        this.state.units.set(unit.id, unit);
      });
    });

    this.state.status = "playing";
    this.state.currentRound = 1;
    this.state.activePlayerId = players[0]!.id;
    this.state.actionPointsRemaining =
      GAME_CONFIG.actions.actionPointsPerTurn;
    this.state.winnerId = "";
    this.lock();
  }

  private checkVictory(attackingPlayerId: string): boolean {
    const opponentStillAlive = [...this.state.units.values()].some(
      (unit) => unit.ownerId !== attackingPlayerId && unit.alive,
    );
    if (opponentStillAlive) return false;

    this.state.status = "finished";
    this.state.winnerId = attackingPlayerId;
    this.state.activePlayerId = "";
    this.state.actionPointsRemaining = 0;
    this.broadcast("match:finished", { winnerId: attackingPlayerId });
    return true;
  }

  private advanceIfOutOfActions(): void {
    if (this.state.actionPointsRemaining === 0) this.advanceTurn();
  }

  private advanceTurn(): void {
    const playerIds = this.orderedPlayers().map((player) => player.id);
    if (playerIds.length < 2) {
      this.resetToWaiting();
      return;
    }

    const next = nextTurn(
      playerIds,
      this.state.activePlayerId,
      this.state.currentRound,
    );
    this.state.activePlayerId = next.activePlayerId;
    this.state.currentRound = next.round;
    this.state.actionPointsRemaining =
      GAME_CONFIG.actions.actionPointsPerTurn;
  }

  private blockedPositions(): Position[] {
    return [...this.state.tiles.values()]
      .filter((tile) => !tile.walkable)
      .map((tile) => ({ x: tile.x, y: tile.y }));
  }

  private occupiedPositions(exceptUnitId: string): Position[] {
    return [...this.state.units.values()]
      .filter((unit) => unit.alive && unit.id !== exceptUnitId)
      .map((unit) => ({ x: unit.x, y: unit.y }));
  }

  private attackTiles(): AttackTile[] {
    return [...this.state.tiles.values()].map((tile) => ({
      x: tile.x,
      y: tile.y,
      blocksLineOfSight: tile.blocksLineOfSight,
      coverValue: tile.coverValue,
    }));
  }

  private orderedPlayers(): PlayerState[] {
    return [...this.state.players.values()].sort((a, b) => a.slot - b.slot);
  }

  private nextAvailableSlot(): number {
    const occupiedSlots = new Set(
      [...this.state.players.values()].map((player) => player.slot),
    );
    for (let slot = 0; slot < GAME_CONFIG.room.maxPlayers; slot += 1) {
      if (!occupiedSlots.has(slot)) return slot;
    }
    throw new Error("Room has no available player slot.");
  }

  private removePlayer(playerId: string): void {
    this.state.players.delete(playerId);
    for (const [unitId, unit] of this.state.units.entries()) {
      if (unit.ownerId === playerId) this.state.units.delete(unitId);
    }
    if (this.state.status !== "waiting") this.resetToWaiting();
  }

  private resetToWaiting(): void {
    this.unlock();
    this.state.status = "waiting";
    this.state.currentRound = 0;
    this.state.activePlayerId = "";
    this.state.actionPointsRemaining = 0;
    this.state.winnerId = "";
    this.state.units.clear();
    for (const player of this.state.players.values()) player.ready = false;
  }

  private reject(client: Client, message: string): void {
    client.send("action:error", { message });
  }

  private async reserveRoomCode(): Promise<string> {
    const existingCodes = await this.presence.smembers(ROOM_CODE_CHANNEL);
    let code = "";
    do {
      code = Array.from({ length: GAME_CONFIG.room.codeLength }, () => {
        const index = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
        return ROOM_CODE_ALPHABET[index]!;
      }).join("");
    } while (existingCodes.includes(code));

    await this.presence.sadd(ROOM_CODE_CHANNEL, code);
    return code;
  }
}
