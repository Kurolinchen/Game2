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
const secondRoom = await secondClient.joinById(firstRoom.roomId, {
  displayName: "Bravo",
});
let rejection = "";
firstRoom.onMessage("action:accepted", () => {});
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
      defeatedUnits: defeatedUnits.length,
      winner: "Alpha",
      completedRounds: firstRoom.state.currentRound,
    }),
  );
} finally {
  await Promise.allSettled([firstRoom.leave(true), secondRoom.leave(true)]);
}
