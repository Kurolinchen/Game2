import { Client } from "@colyseus/sdk";

const endpoint = process.env.SERVER_URL ?? "http://localhost:2567";

async function waitFor(predicate, description, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}.`);
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

  let firstUnit;
  firstRoom.state.units.forEach((unit) => {
    if (unit.ownerId === firstRoom.sessionId) firstUnit = unit;
  });
  if (!firstUnit) throw new Error("The first player's test unit did not spawn.");

  firstRoom.send("move", { unitId: firstUnit.id, x: 2, y: 3 });
  await waitFor(() => rejection.includes("blocked"), "an obstacle rejection");
  if (firstUnit.x !== 1 || firstUnit.y !== 3) {
    throw new Error("The server applied a rejected movement request.");
  }

  firstRoom.send("move", { unitId: firstUnit.id, x: 1, y: 2 });
  await waitFor(
    () =>
      firstUnit.x === 1 &&
      firstUnit.y === 2 &&
      firstRoom.state.activePlayerId === secondRoom.sessionId,
    "the authoritative move and turn change",
  );

  console.log(
    JSON.stringify({
      ok: true,
      roomCode: firstRoom.roomId,
      players: firstRoom.state.players.size,
      unitPosition: { x: firstUnit.x, y: firstUnit.y },
      obstacleRejected: true,
      activePlayerChanged: true,
      round: firstRoom.state.currentRound,
    }),
  );
} finally {
  await Promise.allSettled([firstRoom.leave(true), secondRoom.leave(true)]);
}
