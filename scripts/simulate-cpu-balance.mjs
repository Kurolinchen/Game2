import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@colyseus/sdk";
import {
  chooseCpuAction,
  createSeededRandom,
} from "../apps/server/dist/rooms/cpuOpponent.js";

const PORT = 2677;
const ENDPOINT = `http://127.0.0.1:${PORT}`;
const DIFFICULTIES = ["easy", "normal", "hard"];
const SEEDS = [17, 41, 89];

function waitFor(predicate, description, timeoutMs = 8_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${description}.`));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

function values(collection) {
  return collection ? [...collection.values()] : [];
}

function fingerprint(state) {
  return JSON.stringify({
    status: state.status,
    round: state.currentRound,
    activePlayerId: state.activePlayerId,
    ap: state.actionPointsRemaining,
    units: values(state.units).map((unit) => [
      unit.id,
      unit.x,
      unit.y,
      unit.hp,
      unit.alive,
      unit.overwatchActive,
      [...unit.cooldowns.entries()],
    ]),
  });
}

function decisionContext(room, random) {
  const state = room.state;
  return {
    difficulty: "normal",
    playerId: room.sessionId,
    actionPoints: state.actionPointsRemaining,
    boardWidth: state.boardWidth,
    boardHeight: state.boardHeight,
    random,
    units: values(state.units).map((unit) => ({
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
    tiles: values(state.tiles).map((tile) => ({
      x: tile.x,
      y: tile.y,
      walkable: tile.walkable,
      blocksLineOfSight: tile.blocksLineOfSight,
      coverValue: tile.coverValue,
    })),
  };
}

function sendDecision(room, decision) {
  if (decision.type === "move") {
    room.send("move", decision);
  } else if (decision.type === "attack") {
    room.send("attack", decision);
  } else if (decision.type === "ability") {
    room.send("ability", decision);
  } else {
    room.send("end_turn");
  }
}

async function runMatch(client, difficulty, seed) {
  const room = await client.create("tactics", {
    displayName: "Balance Bot",
    opponent: "cpu",
    cpuDifficulty: difficulty,
    cpuSeed: seed,
    cpuStepDelayMs: 0,
  });
  let serverError = "";
  room.onMessage("action:error", (payload) => {
    serverError = payload?.message ?? "Unknown action rejection";
  });
  room.onMessage("action:accepted", () => undefined);
  room.onMessage("match:finished", () => undefined);

  try {
    await waitFor(() => room.state.players?.size === 2, "CPU room state");
    room.send("ready");
    await waitFor(() => room.state.status === "playing", "match start");
    const random = createSeededRandom(seed * 997 + 13);

    for (let step = 0; step < 500 && room.state.status === "playing"; step += 1) {
      if (serverError) throw new Error(serverError);
      const before = fingerprint(room.state);
      if (room.state.activePlayerId === room.sessionId) {
        sendDecision(room, chooseCpuAction(decisionContext(room, random)));
      }
      await waitFor(
        () => fingerprint(room.state) !== before || Boolean(serverError),
        "next simulated action",
      );
    }

    if (room.state.status !== "finished") {
      throw new Error(`${difficulty} match with seed ${seed} did not finish.`);
    }
    return {
      cpuWon: room.state.winnerId !== room.sessionId,
      rounds: room.state.currentRound,
    };
  } finally {
    await room.leave(true).catch(() => undefined);
  }
}

const serverOutput = [];
const server = spawn(process.execPath, ["apps/server/dist/index.js"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    PORT: String(PORT),
    ALLOW_TEST_OPTIONS: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => serverOutput.push(chunk.toString()));
server.stderr.on("data", (chunk) => serverOutput.push(chunk.toString()));

try {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${ENDPOINT}/health`);
      if (response.ok) break;
    } catch {
      await delay(50);
    }
  }

  const client = new Client(ENDPOINT);
  const results = {};
  for (const difficulty of DIFFICULTIES) {
    results[difficulty] = [];
    for (const seed of SEEDS) {
      results[difficulty].push(await runMatch(client, difficulty, seed));
    }
  }

  const summary = Object.fromEntries(
    DIFFICULTIES.map((difficulty) => [
      difficulty,
      {
        cpuWins: results[difficulty].filter((result) => result.cpuWon).length,
        matches: results[difficulty].length,
        averageRounds:
          results[difficulty].reduce((sum, result) => sum + result.rounds, 0) /
          results[difficulty].length,
      },
    ]),
  );

  if (
    summary.normal.cpuWins < summary.easy.cpuWins ||
    summary.hard.cpuWins < summary.normal.cpuWins
  ) {
    throw new Error(
      `Balance regression: expected non-decreasing CPU wins, got easy=${summary.easy.cpuWins}, normal=${summary.normal.cpuWins}, hard=${summary.hard.cpuWins}.`,
    );
  }
  console.log(JSON.stringify({ ok: true, summary }));
} catch (error) {
  console.error(serverOutput.join(""));
  throw error;
} finally {
  server.kill("SIGTERM");
}
