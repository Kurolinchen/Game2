import { Client } from "@colyseus/sdk";
import {
  GAME_CONFIG,
  findReachableTiles,
  manhattanDistance,
  validateAttack,
} from "@tactics-lite/game-core";

const endpoint = process.env.SERVER_URL ?? "http://localhost:2567";

async function waitFor(predicate, description, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function units(state) {
  return [...state.units.values()];
}

function attackTiles(state) {
  return [...state.tiles.values()].map((tile) => ({
    x: tile.x,
    y: tile.y,
    blocksLineOfSight: tile.blocksLineOfSight,
    coverValue: tile.coverValue,
  }));
}

function findAttack(state, ownerId) {
  const allies = units(state).filter(
    (unit) => unit.ownerId === ownerId && unit.alive,
  );
  const enemies = units(state).filter(
    (unit) => unit.ownerId !== ownerId && unit.alive,
  );
  for (const attacker of allies) {
    for (const target of enemies) {
      const validation = validateAttack({
        attacker,
        target,
        tiles: attackTiles(state),
        actionPointsAvailable: state.actionPointsRemaining,
        actionPointCost: GAME_CONFIG.actions.standardAttackCost,
      });
      if (validation.ok) return { attacker, target };
    }
  }
  return null;
}

function findMove(state, ownerId) {
  const allies = units(state).filter(
    (unit) => unit.ownerId === ownerId && unit.alive,
  );
  const enemies = units(state).filter(
    (unit) => unit.ownerId !== ownerId && unit.alive,
  );
  const blocked = [...state.tiles.values()]
    .filter((tile) => !tile.walkable)
    .map((tile) => ({ x: tile.x, y: tile.y }));
  let best = null;

  for (const unit of allies) {
    const occupied = units(state)
      .filter((candidate) => candidate.alive && candidate.id !== unit.id)
      .map((candidate) => ({ x: candidate.x, y: candidate.y }));
    const reachable = findReachableTiles(
      unit,
      state.boardWidth,
      state.boardHeight,
      blocked,
      occupied,
      unit.movementRange,
      state.actionPointsRemaining,
      GAME_CONFIG.actions.movementCostPerTile,
      unit.movementDiscountAvailable ? 1 : 0,
    );

    for (const target of enemies) {
      const currentDistance = manhattanDistance(unit, target);
      for (const destination of reachable) {
        const distance = manhattanDistance(destination, target);
        if (distance >= currentDistance) continue;
        if (!best || distance < best.distance) {
          best = { unit, destination, distance };
        }
      }
    }
  }
  return best;
}

async function playAggressiveTurn(room, ownerId) {
  let actions = 0;
  while (
    room.state.status === "playing" &&
    room.state.activePlayerId === ownerId &&
    actions < 20
  ) {
    const attack = findAttack(room.state, ownerId);
    if (attack) {
      const previousHp = attack.target.hp;
      const previousAp = room.state.actionPointsRemaining;
      room.send("attack", {
        attackerId: attack.attacker.id,
        targetId: attack.target.id,
      });
      await waitFor(
        () =>
          room.state.status === "finished" ||
          attack.target.hp !== previousHp ||
          room.state.actionPointsRemaining !== previousAp,
        "an authoritative attack",
      );
      actions += 1;
      continue;
    }

    const move = findMove(room.state, ownerId);
    if (!move) {
      room.send("end_turn");
      await waitFor(
        () => room.state.activePlayerId !== ownerId,
        "a forced turn change",
      );
      return;
    }

    const previous = `${move.unit.x}:${move.unit.y}`;
    const previousAp = room.state.actionPointsRemaining;
    room.send("move", {
      unitId: move.unit.id,
      x: move.destination.x,
      y: move.destination.y,
    });
    await waitFor(
      () =>
        `${move.unit.x}:${move.unit.y}` !== previous ||
        room.state.actionPointsRemaining !== previousAp,
      "an authoritative movement",
    );
    actions += 1;
  }
}

const firstClient = new Client(endpoint);
const secondClient = new Client(endpoint);
const firstRoom = await firstClient.create("tactics", { displayName: "Alpha" });
firstRoom.onMessage("player:reconnecting", () => {});
firstRoom.onMessage("player:reconnected", () => {});
let secondRoom = await secondClient.joinById(firstRoom.roomId, {
  displayName: "Bravo",
});
const secondSessionId = secondRoom.sessionId;
const secondReconnectToken = secondRoom.reconnectionToken;
secondRoom.reconnection.enabled = false;
await secondRoom.leave(false);
secondRoom = await secondClient.reconnect(secondReconnectToken);
if (secondRoom.sessionId !== secondSessionId) {
  throw new Error("Reconnect did not preserve the player's session.");
}
let rejection = "";
const abilitiesUsed = new Set();
let overwatchTriggered = false;
firstRoom.onMessage("action:accepted", (payload) => {
  if (payload.type === "ability") abilitiesUsed.add(payload.abilityId);
  if (payload.type === "overwatch") overwatchTriggered = true;
});
secondRoom.onMessage("action:accepted", () => {});
firstRoom.onMessage("match:finished", () => {});
secondRoom.onMessage("match:finished", () => {});
firstRoom.onMessage("action:error", (payload) => {
  rejection = payload.message;
});

try {
  await waitFor(
    () => firstRoom.state.players.size === 2,
    "both players to synchronize",
  );
  firstRoom.send("ready");
  secondRoom.send("ready");
  await waitFor(
    () => firstRoom.state.status === "playing",
    "the ready check to start the match",
  );

  if (firstRoom.state.units.size !== 6) {
    throw new Error(`Expected six units, got ${firstRoom.state.units.size}.`);
  }
  if (
    firstRoom.state.actionPointsRemaining !==
    GAME_CONFIG.actions.actionPointsPerTurn
  ) {
    throw new Error("The match did not start with the configured AP pool.");
  }

  const alphaBreacher = units(firstRoom.state).find(
    (unit) =>
      unit.ownerId === firstRoom.sessionId && unit.classId === "breacher",
  );
  if (!alphaBreacher) throw new Error("Alpha's Breacher did not spawn.");

  firstRoom.send("move", { unitId: alphaBreacher.id, x: 2, y: 2 });
  await waitFor(
    () => rejection.includes("unreachable"),
    "the server to reject movement onto cover",
  );
  if (alphaBreacher.x !== 0 || alphaBreacher.y !== 1) {
    throw new Error("The server applied a rejected movement request.");
  }

  const alphaSniper = units(firstRoom.state).find(
    (unit) => unit.ownerId === firstRoom.sessionId && unit.classId === "sniper",
  );
  const alphaTrickster = units(firstRoom.state).find(
    (unit) =>
      unit.ownerId === firstRoom.sessionId && unit.classId === "trickster",
  );
  const bravoBreacher = units(firstRoom.state).find(
    (unit) =>
      unit.ownerId === secondRoom.sessionId && unit.classId === "breacher",
  );
  const bravoSniper = units(firstRoom.state).find(
    (unit) => unit.ownerId === secondRoom.sessionId && unit.classId === "sniper",
  );
  if (!alphaSniper || !alphaTrickster || !bravoBreacher || !bravoSniper) {
    throw new Error("The Phase 3 ability test squad did not spawn.");
  }

  firstRoom.send("ability", {
    unitId: alphaTrickster.id,
    abilityId: "swap",
    targetUnitId: alphaSniper.id,
  });
  await waitFor(
    () => alphaTrickster.x === 0 && alphaTrickster.y === 3,
    "Swap to exchange allied positions",
  );
  firstRoom.send("ability", {
    unitId: alphaTrickster.id,
    abilityId: "decoy",
    x: 1,
    y: 3,
  });
  await waitFor(
    () => units(firstRoom.state).some((unit) => unit.isDecoy),
    "Decoy to create a synchronized unit",
  );
  firstRoom.send("end_turn");
  await waitFor(
    () => firstRoom.state.activePlayerId === secondRoom.sessionId,
    "Bravo's first turn",
  );

  secondRoom.send("ability", {
    unitId: bravoSniper.id,
    abilityId: "overwatch",
  });
  await waitFor(() => bravoSniper.overwatchActive, "Overwatch activation");
  secondRoom.send("end_turn");
  await waitFor(
    () => firstRoom.state.activePlayerId === firstRoom.sessionId,
    "Alpha's second turn",
  );

  const tricksterHpBeforeOverwatch = alphaTrickster.hp;
  firstRoom.send("move", { unitId: alphaTrickster.id, x: 2, y: 3 });
  await waitFor(
    () =>
      overwatchTriggered &&
      !bravoSniper.overwatchActive &&
      alphaTrickster.hp < tricksterHpBeforeOverwatch,
    "the Overwatch reaction shot",
  );
  firstRoom.send("end_turn");
  await waitFor(
    () => firstRoom.state.activePlayerId === secondRoom.sessionId,
    "Bravo's second turn",
  );

  secondRoom.send("move", { unitId: bravoBreacher.id, x: 6, y: 2 });
  await waitFor(
    () => bravoBreacher.x === 6 && bravoBreacher.y === 2,
    "Bravo Breacher movement",
  );
  secondRoom.send("ability", {
    unitId: bravoBreacher.id,
    abilityId: "breach",
    x: 5,
    y: 2,
  });
  await waitFor(
    () =>
      [...firstRoom.state.tiles.values()].some(
        (tile) => tile.x === 5 && tile.y === 2 && tile.tileType === "floor",
      ),
    "Breach to destroy low cover",
  );
  secondRoom.send("end_turn");
  await waitFor(
    () => firstRoom.state.activePlayerId === firstRoom.sessionId,
    "Alpha's third turn",
  );

  firstRoom.send("move", { unitId: alphaSniper.id, x: 1, y: 5 });
  await waitFor(
    () => alphaSniper.x === 1 && alphaSniper.y === 5,
    "Alpha Sniper movement",
  );
  firstRoom.send("ability", {
    unitId: alphaSniper.id,
    abilityId: "long-shot",
    targetUnitId: bravoSniper.id,
  });
  await waitFor(() => !bravoSniper.alive, "a lethal Long Shot");
  firstRoom.send("end_turn");
  await waitFor(
    () => firstRoom.state.activePlayerId === secondRoom.sessionId,
    "Bravo's third turn",
  );

  secondRoom.send("move", { unitId: bravoBreacher.id, x: 3, y: 2 });
  await waitFor(
    () => bravoBreacher.x === 3 && bravoBreacher.y === 2,
    "Bravo Breacher repositioning",
  );
  secondRoom.send("ability", {
    unitId: bravoBreacher.id,
    abilityId: "breach",
    x: 2,
    y: 2,
  });
  await waitFor(
    () =>
      [...firstRoom.state.tiles.values()].some(
        (tile) => tile.x === 2 && tile.y === 2 && tile.tileType === "floor",
      ),
    "a second Breach after its one-turn cooldown",
  );
  secondRoom.send("end_turn");
  await waitFor(
    () => firstRoom.state.activePlayerId === firstRoom.sessionId,
    "Alpha's fourth turn",
  );
  firstRoom.send("end_turn");
  await waitFor(
    () => firstRoom.state.activePlayerId === secondRoom.sessionId,
    "Bravo's fourth turn",
  );

  secondRoom.send("move", { unitId: bravoBreacher.id, x: 2, y: 2 });
  await waitFor(
    () => bravoBreacher.x === 2 && bravoBreacher.y === 2,
    "Bravo Breacher push setup",
  );
  const tricksterHpBeforePush = alphaTrickster.hp;
  secondRoom.send("ability", {
    unitId: bravoBreacher.id,
    abilityId: "kinetic-push",
    targetUnitId: alphaTrickster.id,
  });
  await waitFor(
    () =>
      alphaTrickster.y === 4 && alphaTrickster.hp < tricksterHpBeforePush,
    "Kinetic Push movement and damage",
  );
  secondRoom.send("end_turn");
  await waitFor(
    () => firstRoom.state.activePlayerId === firstRoom.sessionId,
    "the post-ability elimination match",
  );

  const expectedAbilities = [
    "swap",
    "decoy",
    "overwatch",
    "breach",
    "long-shot",
    "kinetic-push",
  ];
  if (expectedAbilities.some((abilityId) => !abilitiesUsed.has(abilityId))) {
    throw new Error(
      `Not every Phase 3 ability synchronized: ${[...abilitiesUsed].join(", ")}.`,
    );
  }

  let cycles = 0;
  while (firstRoom.state.status === "playing" && cycles < 80) {
    if (firstRoom.state.activePlayerId === firstRoom.sessionId) {
      await playAggressiveTurn(firstRoom, firstRoom.sessionId);
    } else {
      secondRoom.send("end_turn");
      await waitFor(
        () =>
          firstRoom.state.status === "finished" ||
          firstRoom.state.activePlayerId === firstRoom.sessionId,
        "Bravo to end the turn",
      );
    }
    cycles += 1;
  }

  await waitFor(
    () => firstRoom.state.status === "finished",
    "a complete elimination match",
    10_000,
  );
  const defeatedUnits = units(firstRoom.state).filter(
    (unit) => unit.ownerId === secondRoom.sessionId && !unit.alive,
  );
  if (
    firstRoom.state.winnerId !== firstRoom.sessionId ||
    defeatedUnits.length !== 3
  ) {
    throw new Error("The authoritative victory condition was not applied.");
  }

  console.log(
    JSON.stringify({
      ok: true,
      roomCode: firstRoom.roomId,
      synchronizedUnits: firstRoom.state.units.size,
      coverMoveRejected: true,
      reconnected: true,
      abilitiesUsed: expectedAbilities,
      overwatchTriggered,
      defeatedUnits: defeatedUnits.length,
      winner: "Alpha",
      completedRounds: firstRoom.state.currentRound,
    }),
  );
} finally {
  await Promise.allSettled([firstRoom.leave(true), secondRoom.leave(true)]);
}
