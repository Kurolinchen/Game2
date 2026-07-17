import { Client, Room } from "colyseus";
import {
  ABILITY_DEFINITIONS,
  CLASS_ABILITIES,
  GAME_CONFIG,
  MAP_DEFINITIONS,
  UNIT_CLASS_ORDER,
  UNIT_DEFINITIONS,
  applyDamage,
  calculateLongShotBaseDamage,
  calculateModifiedDamage,
  createMapTiles,
  getCoverReduction,
  hasLineOfSight,
  manhattanDistance,
  nextTurn,
  parseMapId,
  resolvePush,
  validateAttack,
  validateMovementAction,
  type AttackTile,
  type AbilityDefinition,
  type AbilityId,
  type Position,
  type MapId,
} from "@tactics-lite/game-core";
import { sanitizeDisplayName } from "./displayName.js";
import { FixedWindowRateLimiter } from "../rateLimit.js";
import {
  CPU_DIFFICULTY_LABELS,
  CPU_PLAYER_ID,
  chooseCpuAction,
  createSeededRandom,
  parseCpuDifficulty,
  type CpuDifficulty,
} from "./cpuOpponent.js";
import {
  MatchState,
  PlayerState,
  PlayerStatsState,
  TileState,
  UnitState,
} from "./schema/MatchState.js";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_CHANNEL = "$tactics-lite-room-codes";
const RECONNECT_GRACE_SECONDS = 60;

interface JoinOptions {
  displayName?: unknown;
}

interface RoomOptions extends JoinOptions {
  opponent?: unknown;
  cpuDifficulty?: unknown;
  cpuSeed?: unknown;
  cpuStepDelayMs?: unknown;
  mapId?: unknown;
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

interface AbilityMessage {
  unitId?: unknown;
  abilityId?: unknown;
  targetUnitId?: unknown;
  x?: unknown;
  y?: unknown;
}

interface AbilityOutcome {
  event: Record<string, unknown>;
  checkVictory?: boolean;
}

export class TacticsRoom extends Room<{ state: MatchState }> {
  state = new MatchState();
  maxClients: number = GAME_CONFIG.room.maxPlayers;
  private cpuDifficulty?: CpuDifficulty;
  private cpuActionsThisTurn = 0;
  private cpuRandom: () => number = Math.random;
  private cpuStepDelayMs = 420;
  private readonly actionLimiter = new FixedWindowRateLimiter(60, 1_000);
  private readonly cpuClient = {
    sessionId: CPU_PLAYER_ID,
    send: () => undefined,
  } as unknown as Client;

  messages = {
    ready: (client: Client) =>
      this.acceptClientMessage(client) && this.handleReady(client),
    move: (client: Client, payload: MoveMessage) =>
      this.acceptClientMessage(client) && this.handleMove(client, payload),
    attack: (client: Client, payload: AttackMessage) =>
      this.acceptClientMessage(client) && this.handleAttack(client, payload),
    ability: (client: Client, payload: AbilityMessage) =>
      this.acceptClientMessage(client) && this.handleAbility(client, payload),
    end_turn: (client: Client) =>
      this.acceptClientMessage(client) && this.handleEndTurn(client),
    surrender: (client: Client) =>
      this.acceptClientMessage(client) && this.handleSurrender(client),
    rematch: (client: Client) =>
      this.acceptClientMessage(client) && this.handleRematch(client),
  };

  async onCreate(options: RoomOptions = {}): Promise<void> {
    this.roomId = await this.reserveRoomCode();
    this.setPrivate();

    this.state.roomCode = this.roomId;
    this.state.mapId = parseMapId(options.mapId);
    this.state.boardWidth = GAME_CONFIG.board.width;
    this.state.boardHeight = GAME_CONFIG.board.height;
    this.state.tiles.push(
      ...createMapTiles(this.state.mapId as MapId).map((tile) =>
        TileState.fromTile(tile),
      ),
    );

    if (options.opponent === "cpu") {
      this.cpuDifficulty = parseCpuDifficulty(options.cpuDifficulty);
      if (typeof options.cpuSeed === "number" && Number.isFinite(options.cpuSeed)) {
        this.cpuRandom = createSeededRandom(options.cpuSeed);
      }
      if (
        process.env.ALLOW_TEST_OPTIONS === "true" &&
        typeof options.cpuStepDelayMs === "number" &&
        Number.isFinite(options.cpuStepDelayMs)
      ) {
        this.cpuStepDelayMs = Math.max(0, Math.min(420, options.cpuStepDelayMs));
      }
      this.maxClients = 1;
      this.addCpuPlayer(this.cpuDifficulty);
    }
    this.log("room_created", { mapId: this.state.mapId, cpu: Boolean(this.cpuDifficulty) });
  }

  onJoin(client: Client, options: JoinOptions): void {
    const player = new PlayerState();
    player.id = client.sessionId;
    player.displayName = sanitizeDisplayName(options.displayName);
    player.slot = this.nextAvailableSlot();
    player.ready = false;
    player.connected = true;
    player.isCpu = false;
    player.difficulty = "";
    player.rematchReady = false;
    this.state.players.set(client.sessionId, player);
    this.log("player_joined", { playerId: client.sessionId, slot: player.slot });
  }

  onDrop(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    this.log("player_dropped", { playerId: client.sessionId });
    this.broadcast("player:reconnecting", {
      playerId: client.sessionId,
      graceSeconds: RECONNECT_GRACE_SECONDS,
    });
    this.allowReconnection(client, RECONNECT_GRACE_SECONDS);
  }

  onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
    this.log("player_reconnected", { playerId: client.sessionId });
    this.broadcast(
      "player:reconnected",
      { playerId: client.sessionId },
      { except: client },
    );
  }

  onLeave(client: Client): void {
    this.removePlayer(client.sessionId);
  }

  async onDispose(): Promise<void> {
    await this.presence.srem(ROOM_CODE_CHANNEL, this.roomId);
    this.log("room_disposed");
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
    if (
      !unit ||
      unit.ownerId !== client.sessionId ||
      !unit.alive ||
      unit.isDecoy
    ) {
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
      actionPointDiscount: unit.movementDiscountAvailable ? 1 : 0,
    });

    if (!validation.ok) {
      return this.reject(client, `Move rejected: ${validation.reason}.`);
    }

    unit.x = payload.x;
    unit.y = payload.y;
    if (unit.movementDiscountAvailable) unit.movementDiscountAvailable = false;
    this.state.actionPointsRemaining -= validation.cost;
    this.recordAction(unit.ownerId, { movesMade: 1, apSpent: validation.cost });
    this.broadcast("action:accepted", {
      type: "move",
      unitId: unit.id,
      x: unit.x,
      y: unit.y,
      apCost: validation.cost,
      path: validation.path,
    });
    if (this.resolveOverwatch(unit, validation.path)) return;
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
    if (
      !attacker ||
      attacker.ownerId !== client.sessionId ||
      attacker.isDecoy
    ) {
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

    const previousHp = target.hp;
    const wasAlive = target.alive;
    const outcome = applyDamage(target.hp, validation.damage);
    target.hp = outcome.hp;
    target.alive = outcome.alive;
    this.state.actionPointsRemaining -= validation.cost;
    this.recordAction(attacker.ownerId, {
      damageDealt: Math.min(previousHp, validation.damage),
      unitsEliminated: wasAlive && !target.alive && !target.isDecoy ? 1 : 0,
      apSpent: validation.cost,
    });

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

  private handleAbility(client: Client, payload: AbilityMessage): void {
    if (!this.canAct(client)) return;
    if (
      typeof payload.unitId !== "string" ||
      typeof payload.abilityId !== "string" ||
      !(payload.abilityId in ABILITY_DEFINITIONS)
    ) {
      return this.reject(client, "Invalid ability request.");
    }

    const unit = this.state.units.get(payload.unitId);
    const ability = ABILITY_DEFINITIONS[payload.abilityId as AbilityId];
    if (
      !unit ||
      unit.ownerId !== client.sessionId ||
      !unit.alive ||
      unit.isDecoy
    ) {
      return this.reject(client, "You do not control that active unit.");
    }
    if (unit.classId !== ability.classId) {
      return this.reject(client, `${unit.name} cannot use ${ability.name}.`);
    }
    if ((unit.cooldowns.get(ability.id) ?? 0) > 0) {
      return this.reject(client, `${ability.name} is on cooldown.`);
    }
    if (this.state.actionPointsRemaining < ability.actionPointCost) {
      return this.reject(client, `Not enough AP for ${ability.name}.`);
    }

    const outcome = this.resolveAbility(client, unit, ability, payload);
    if (!outcome) return;

    this.state.actionPointsRemaining -= ability.actionPointCost;
    unit.cooldowns.set(ability.id, ability.cooldown);
    this.recordAction(unit.ownerId, {
      abilitiesUsed: 1,
      apSpent: ability.actionPointCost,
      damageDealt:
        typeof outcome.event.damage === "number" ? outcome.event.damage : 0,
      unitsEliminated:
        outcome.event.eliminated === true &&
        typeof outcome.event.targetId === "string" &&
        !this.state.units.get(outcome.event.targetId)?.isDecoy
          ? 1
          : 0,
    });
    this.broadcast("action:accepted", {
      type: "ability",
      unitId: unit.id,
      abilityId: ability.id,
      abilityName: ability.name,
      apCost: ability.actionPointCost,
      ...outcome.event,
    });

    if (outcome.checkVictory && this.checkVictory(unit.ownerId)) return;
    this.advanceIfOutOfActions();
  }

  private resolveAbility(
    client: Client,
    unit: UnitState,
    ability: AbilityDefinition,
    payload: AbilityMessage,
  ): AbilityOutcome | null {
    switch (ability.id) {
      case "kinetic-push":
        return this.useKineticPush(client, unit, payload);
      case "breach":
        return this.useBreach(client, unit, payload);
      case "long-shot":
        return this.useLongShot(client, unit, payload);
      case "overwatch":
        unit.overwatchActive = true;
        unit.overwatchExpiresRound = this.state.currentRound + 1;
        return { event: { active: true } };
      case "swap":
        return this.useSwap(client, unit, payload);
      case "decoy":
        return this.useDecoy(client, unit, payload);
    }
  }

  private useKineticPush(
    client: Client,
    unit: UnitState,
    payload: AbilityMessage,
  ): AbilityOutcome | null {
    const target = this.targetUnit(client, payload.targetUnitId);
    if (!target) return null;
    if (target.ownerId === unit.ownerId) {
      this.reject(client, "Kinetic Push requires an enemy target.");
      return null;
    }

    const push = resolvePush({
      attacker: unit,
      target,
      boardWidth: this.state.boardWidth,
      boardHeight: this.state.boardHeight,
      blocked: this.blockedPositions(),
      occupied: this.occupiedPositions(target.id).filter(
        (position) => position.x !== unit.x || position.y !== unit.y,
      ),
    });
    if (!push) {
      this.reject(client, "Kinetic Push requires an adjacent enemy.");
      return null;
    }

    const baseDamage =
      GAME_CONFIG.actions.pushDamage +
      (push.collided ? GAME_CONFIG.actions.pushCollisionDamage : 0);
    const damage = calculateModifiedDamage(
      baseDamage,
      1,
      "breacher",
      this.combatClass(target),
    ).damage;
    target.x = push.destination.x;
    target.y = push.destination.y;
    this.damageUnit(target, damage);
    return {
      event: {
        targetId: target.id,
        x: target.x,
        y: target.y,
        collided: push.collided,
        damage,
        remainingHp: target.hp,
        eliminated: !target.alive,
      },
      checkVictory: true,
    };
  }

  private useBreach(
    client: Client,
    unit: UnitState,
    payload: AbilityMessage,
  ): AbilityOutcome | null {
    const position = this.targetPosition(client, payload);
    if (!position) return null;
    if (manhattanDistance(unit, position) !== 1) {
      this.reject(client, "Breach requires adjacent low cover.");
      return null;
    }
    const tile = [...this.state.tiles.values()].find(
      (candidate) => candidate.x === position.x && candidate.y === position.y,
    );
    if (!tile || tile.tileType !== "cover") {
      this.reject(client, "Breach can only destroy low cover.");
      return null;
    }
    tile.tileType = "floor";
    tile.walkable = true;
    tile.blocksLineOfSight = false;
    tile.coverValue = 0;
    return { event: { x: tile.x, y: tile.y, destroyedCover: true } };
  }

  private useLongShot(
    client: Client,
    unit: UnitState,
    payload: AbilityMessage,
  ): AbilityOutcome | null {
    const target = this.targetUnit(client, payload.targetUnitId);
    if (!target) return null;
    if (target.ownerId === unit.ownerId) {
      this.reject(client, "Long Shot requires an enemy target.");
      return null;
    }
    const distance = manhattanDistance(unit, target);
    if (distance > ABILITY_DEFINITIONS["long-shot"].range) {
      this.reject(client, "Long Shot target is out of range.");
      return null;
    }
    if (!hasLineOfSight(unit, target, this.attackTiles())) {
      this.reject(client, "Long Shot is blocked by an obstacle.");
      return null;
    }
    const coverReduction = getCoverReduction(unit, target, this.attackTiles());
    const calculation = calculateModifiedDamage(
      calculateLongShotBaseDamage(distance),
      distance,
      "sniper",
      this.combatClass(target),
      coverReduction,
    );
    this.damageUnit(target, calculation.damage);
    return {
      event: {
        targetId: target.id,
        distance,
        damage: calculation.damage,
        coverReduction,
        remainingHp: target.hp,
        eliminated: !target.alive,
      },
      checkVictory: true,
    };
  }

  private useSwap(
    client: Client,
    unit: UnitState,
    payload: AbilityMessage,
  ): AbilityOutcome | null {
    const target = this.targetUnit(client, payload.targetUnitId);
    if (!target) return null;
    if (target.id === unit.id || manhattanDistance(unit, target) > 4) {
      this.reject(client, "Swap requires another living unit within 4 tiles.");
      return null;
    }
    const origin = { x: unit.x, y: unit.y };
    unit.x = target.x;
    unit.y = target.y;
    target.x = origin.x;
    target.y = origin.y;
    return {
      event: {
        targetId: target.id,
        unitPosition: { x: unit.x, y: unit.y },
        targetPosition: { x: target.x, y: target.y },
      },
    };
  }

  private useDecoy(
    client: Client,
    unit: UnitState,
    payload: AbilityMessage,
  ): AbilityOutcome | null {
    const position = this.targetPosition(client, payload);
    if (!position) return null;
    if (manhattanDistance(unit, position) > 3) {
      this.reject(client, "Decoy target is out of range.");
      return null;
    }
    const tile = [...this.state.tiles.values()].find(
      (candidate) => candidate.x === position.x && candidate.y === position.y,
    );
    const occupied = this.occupiedPositions("").some(
      (candidate) => candidate.x === position.x && candidate.y === position.y,
    );
    if (
      !tile ||
      !tile.walkable ||
      occupied ||
      !hasLineOfSight(unit, position, this.attackTiles())
    ) {
      this.reject(client, "Decoy requires a free visible floor tile.");
      return null;
    }

    for (const [id, candidate] of this.state.units.entries()) {
      if (candidate.isDecoy && candidate.ownerId === unit.ownerId) {
        this.state.units.delete(id);
      }
    }
    const decoy = new UnitState();
    decoy.id = `${unit.ownerId}-decoy`;
    decoy.ownerId = unit.ownerId;
    decoy.classId = "decoy";
    decoy.name = "Decoy";
    decoy.x = position.x;
    decoy.y = position.y;
    decoy.hp = GAME_CONFIG.actions.decoyHp;
    decoy.maxHp = GAME_CONFIG.actions.decoyHp;
    decoy.alive = true;
    decoy.isDecoy = true;
    decoy.sourceUnitId = unit.id;
    this.state.units.set(decoy.id, decoy);
    return { event: { decoyId: decoy.id, x: decoy.x, y: decoy.y } };
  }

  private resolveOverwatch(mover: UnitState, path: Position[]): boolean {
    const watcher = [...this.state.units.values()].find(
      (candidate) =>
        candidate.ownerId !== mover.ownerId &&
        candidate.classId === "sniper" &&
        candidate.alive &&
        candidate.overwatchActive &&
        path.some(
          (position) =>
            manhattanDistance(candidate, position) <= candidate.attackRange &&
            hasLineOfSight(candidate, position, this.attackTiles()),
        ),
    );
    if (!watcher) return false;

    watcher.overwatchActive = false;
    const distance = manhattanDistance(watcher, mover);
    const coverReduction = getCoverReduction(watcher, mover, this.attackTiles());
    const damage = calculateModifiedDamage(
      GAME_CONFIG.actions.overwatchDamage,
      distance,
      "sniper",
      this.combatClass(mover),
      coverReduction,
    ).damage;
    const previousHp = mover.hp;
    const wasAlive = mover.alive;
    this.damageUnit(mover, damage);
    this.recordAction(watcher.ownerId, {
      damageDealt: Math.min(previousHp, damage),
      unitsEliminated: wasAlive && !mover.alive && !mover.isDecoy ? 1 : 0,
    });
    this.broadcast("action:accepted", {
      type: "overwatch",
      unitId: watcher.id,
      targetId: mover.id,
      damage,
      remainingHp: mover.hp,
      eliminated: !mover.alive,
    });
    return !mover.alive && this.checkVictory(watcher.ownerId);
  }

  private targetUnit(client: Client, value: unknown): UnitState | null {
    if (typeof value !== "string") {
      this.reject(client, "A target unit is required.");
      return null;
    }
    const target = this.state.units.get(value);
    if (!target || !target.alive) {
      this.reject(client, "Target unit is not alive.");
      return null;
    }
    return target;
  }

  private targetPosition(
    client: Client,
    payload: AbilityMessage,
  ): Position | null {
    if (
      typeof payload.x !== "number" ||
      typeof payload.y !== "number" ||
      !Number.isInteger(payload.x) ||
      !Number.isInteger(payload.y)
    ) {
      this.reject(client, "A valid target tile is required.");
      return null;
    }
    return { x: payload.x, y: payload.y };
  }

  private damageUnit(target: UnitState, damage: number): void {
    const outcome = applyDamage(target.hp, damage);
    target.hp = outcome.hp;
    target.alive = outcome.alive;
  }

  private combatClass(unit: UnitState): "breacher" | "sniper" | "trickster" | undefined {
    return unit.classId === "breacher" ||
      unit.classId === "sniper" ||
      unit.classId === "trickster"
      ? unit.classId
      : undefined;
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

  private handleSurrender(client: Client): void {
    if (this.state.status !== "playing") {
      return this.reject(client, "Only a running match can be surrendered.");
    }
    const winner = this.orderedPlayers().find(
      (player) => player.id !== client.sessionId,
    );
    if (!winner) return this.reject(client, "Opponent not found.");
    this.finishMatch(winner.id, "surrender");
  }

  private handleRematch(client: Client): void {
    if (this.state.status !== "finished") {
      return this.reject(client, "A rematch can be requested after the match.");
    }
    const player = this.state.players.get(client.sessionId);
    if (!player) return this.reject(client, "Player not found in this room.");
    player.rematchReady = true;
    const cpu = this.state.players.get(CPU_PLAYER_ID);
    if (cpu) cpu.rematchReady = true;
    this.broadcast("rematch:updated", { playerId: client.sessionId });
    if (
      this.state.players.size === GAME_CONFIG.room.maxPlayers &&
      [...this.state.players.values()].every((candidate) => candidate.rematchReady)
    ) {
      this.startMatch();
    }
  }

  private addCpuPlayer(difficulty: CpuDifficulty): void {
    const player = new PlayerState();
    player.id = CPU_PLAYER_ID;
    player.displayName = `CPU · ${CPU_DIFFICULTY_LABELS[difficulty]}`;
    player.slot = 1;
    player.ready = true;
    player.connected = true;
    player.isCpu = true;
    player.difficulty = difficulty;
    player.rematchReady = false;
    this.state.players.set(player.id, player);
  }

  private startMatch(): void {
    const players = this.orderedPlayers();
    if (players.length !== GAME_CONFIG.room.maxPlayers) return;

    const mapId = parseMapId(this.state.mapId);
    const map = MAP_DEFINITIONS[mapId];
    this.state.tiles.clear();
    this.state.tiles.push(
      ...createMapTiles(mapId).map((tile) => TileState.fromTile(tile)),
    );
    this.state.units.clear();
    this.state.stats.clear();
    players.forEach((player) => {
      player.rematchReady = false;
      const stats = new PlayerStatsState();
      stats.playerId = player.id;
      this.state.stats.set(player.id, stats);
      UNIT_CLASS_ORDER.forEach((classId, classIndex) => {
        const spawn = map.spawnPoints[player.slot]?.[classIndex];
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
        unit.movementDiscountAvailable = classId === "trickster";
        for (const abilityId of CLASS_ABILITIES[classId]) {
          unit.cooldowns.set(abilityId, 0);
        }
        this.state.units.set(unit.id, unit);
      });
    });

    this.state.status = "playing";
    this.state.currentRound = 1;
    this.state.activePlayerId = players[0]!.id;
    this.state.actionPointsRemaining =
      GAME_CONFIG.actions.actionPointsPerTurn;
    this.state.winnerId = "";
    this.state.winReason = "";
    this.state.matchNumber += 1;
    this.lock();
    this.log("match_started", {
      matchNumber: this.state.matchNumber,
      mapId,
      players: players.map((player) => player.id),
    });
    if (this.state.activePlayerId === CPU_PLAYER_ID) this.scheduleCpuStep();
  }

  private checkVictory(attackingPlayerId: string): boolean {
    const opponentStillAlive = [...this.state.units.values()].some(
      (unit) =>
        unit.ownerId !== attackingPlayerId && unit.alive && !unit.isDecoy,
    );
    if (opponentStillAlive) return false;

    this.finishMatch(attackingPlayerId, "elimination");
    return true;
  }

  private finishMatch(winnerId: string, reason: "elimination" | "surrender"): void {
    this.state.status = "finished";
    this.state.winnerId = winnerId;
    this.state.winReason = reason;
    this.state.activePlayerId = "";
    this.state.actionPointsRemaining = 0;
    this.broadcast("match:finished", { winnerId, reason });
    this.log("match_finished", {
      matchNumber: this.state.matchNumber,
      winnerId,
      reason,
      round: this.state.currentRound,
    });
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
    this.preparePlayerTurn(next.activePlayerId);
    if (next.activePlayerId === CPU_PLAYER_ID) this.scheduleCpuStep();
  }

  private preparePlayerTurn(playerId: string): void {
    if (playerId === CPU_PLAYER_ID) this.cpuActionsThisTurn = 0;
    for (const unit of this.state.units.values()) {
      if (unit.ownerId !== playerId || unit.isDecoy) continue;
      for (const [abilityId, remaining] of unit.cooldowns.entries()) {
        unit.cooldowns.set(abilityId, Math.max(0, remaining - 1));
      }
      unit.movementDiscountAvailable = unit.classId === "trickster";
      if (
        unit.overwatchActive &&
        unit.overwatchExpiresRound <= this.state.currentRound
      ) {
        unit.overwatchActive = false;
      }
    }
  }

  private scheduleCpuStep(): void {
    if (
      !this.cpuDifficulty ||
      this.state.status !== "playing" ||
      this.state.activePlayerId !== CPU_PLAYER_ID
    ) {
      return;
    }
    this.clock.setTimeout(() => this.runCpuStep(), this.cpuStepDelayMs);
  }

  private runCpuStep(): void {
    if (
      !this.cpuDifficulty ||
      this.state.status !== "playing" ||
      this.state.activePlayerId !== CPU_PLAYER_ID
    ) {
      return;
    }
    if (this.cpuActionsThisTurn >= 12) {
      this.advanceTurn();
      return;
    }

    const action = chooseCpuAction({
      difficulty: this.cpuDifficulty,
      playerId: CPU_PLAYER_ID,
      actionPoints: this.state.actionPointsRemaining,
      boardWidth: this.state.boardWidth,
      boardHeight: this.state.boardHeight,
      units: [...this.state.units.values()].map((unit) => ({
        id: unit.id,
        ownerId: unit.ownerId,
        classId: unit.classId,
        x: unit.x,
        y: unit.y,
        hp: unit.hp,
        alive: unit.alive,
        isDecoy: unit.isDecoy,
        movementRange: unit.movementRange,
        attackRange: unit.attackRange,
        attackDamage: unit.attackDamage,
        movementDiscountAvailable: unit.movementDiscountAvailable,
        overwatchActive: unit.overwatchActive,
        cooldowns: Object.fromEntries(unit.cooldowns.entries()),
      })),
      tiles: [...this.state.tiles.values()].map((tile) => ({
        x: tile.x,
        y: tile.y,
        walkable: tile.walkable,
        blocksLineOfSight: tile.blocksLineOfSight,
        coverValue: tile.coverValue,
      })),
      random: this.cpuRandom,
    });

    if (action.type === "end_turn") {
      this.advanceTurn();
      return;
    }

    const before = this.cpuStateFingerprint();
    this.cpuActionsThisTurn += 1;
    if (action.type === "move") {
      this.handleMove(this.cpuClient, action);
    } else if (action.type === "attack") {
      this.handleAttack(this.cpuClient, action);
    } else {
      this.handleAbility(this.cpuClient, action);
    }

    if (
      this.state.status !== "playing" ||
      this.state.activePlayerId !== CPU_PLAYER_ID
    ) {
      return;
    }
    if (before === this.cpuStateFingerprint()) {
      this.advanceTurn();
      return;
    }
    this.scheduleCpuStep();
  }

  private cpuStateFingerprint(): string {
    const units = [...this.state.units.values()].map((unit) =>
      [
        unit.id,
        unit.x,
        unit.y,
        unit.hp,
        unit.alive,
        unit.overwatchActive,
        [...unit.cooldowns.entries()],
      ].join(":"),
    );
    return [
      this.state.status,
      this.state.activePlayerId,
      this.state.actionPointsRemaining,
      ...units,
    ].join("|");
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
    this.state.winReason = "";
    this.state.units.clear();
    this.state.stats.clear();
    this.cpuActionsThisTurn = 0;
    for (const player of this.state.players.values()) {
      player.ready = player.isCpu;
      player.rematchReady = false;
    }
  }

  private recordAction(
    playerId: string,
    delta: Partial<
      Pick<
        PlayerStatsState,
        "damageDealt" | "unitsEliminated" | "abilitiesUsed" | "movesMade" | "apSpent"
      >
    >,
  ): void {
    const stats = this.state.stats.get(playerId);
    if (!stats) return;
    stats.damageDealt += delta.damageDealt ?? 0;
    stats.unitsEliminated += delta.unitsEliminated ?? 0;
    stats.abilitiesUsed += delta.abilitiesUsed ?? 0;
    stats.movesMade += delta.movesMade ?? 0;
    stats.apSpent += delta.apSpent ?? 0;
  }

  private log(event: string, data: Record<string, unknown> = {}): void {
    console.log(JSON.stringify({
      service: "tactics-lite-server",
      event,
      roomId: this.roomId,
      ...data,
    }));
  }

  private reject(client: Client, message: string): void {
    client.send("action:error", { message });
  }

  private acceptClientMessage(client: Client): boolean {
    const result = this.actionLimiter.check(client.sessionId);
    if (!result.allowed) {
      this.reject(client, "Too many actions at once. Slow down for a moment.");
    }
    return result.allowed;
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
