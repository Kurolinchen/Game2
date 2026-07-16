import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { TileSelection } from "./game/GameBridge";
import {
  createTacticsRoom,
  joinTacticsRoom,
  type TacticsRoomConnection,
} from "./multiplayer/client";
import { toMatchSnapshot } from "./multiplayer/snapshot";
import type { MatchSnapshot, NetworkMatchState } from "./multiplayer/types";

type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected";

const Board = lazy(() =>
  import("./game/Board").then((module) => ({ default: module.Board })),
);

const initialRoomCode = new URLSearchParams(window.location.search)
  .get("room")
  ?.toUpperCase() ?? "";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "The room could not be reached.";
}

export default function App() {
  const [displayName, setDisplayName] = useState(
    () => window.localStorage.getItem("tactics-lite-name") ?? "",
  );
  const [roomCode, setRoomCode] = useState(initialRoomCode);
  const [room, setRoom] = useState<TacticsRoomConnection>();
  const [snapshot, setSnapshot] = useState<MatchSnapshot>();
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const localPlayerId = room?.sessionId ?? "";
  const localPlayer = snapshot?.players.find(
    (player) => player.id === localPlayerId,
  );
  const activePlayer = snapshot?.players.find(
    (player) => player.id === snapshot.activePlayerId,
  );
  const isMyTurn = snapshot?.activePlayerId === localPlayerId;

  const attachRoom = useCallback((nextRoom: TacticsRoomConnection) => {
    setRoom(nextRoom);
    setStatus("connected");
    setError("");
    setNotice("");
    setRoomCode(nextRoom.roomId);
    window.history.replaceState({}, "", `?room=${nextRoom.roomId}`);

    nextRoom.onStateChange((state: NetworkMatchState) => {
      setSnapshot(toMatchSnapshot(state));
    });
    nextRoom.onMessage("action:error", (payload: { message?: string }) => {
      setError(payload.message ?? "The server rejected that action.");
    });
    nextRoom.onMessage("action:accepted", () => {
      setError("");
    });
    nextRoom.onLeave(() => {
      setStatus("disconnected");
      setNotice("Connection closed. Return to the lobby to start again.");
    });
  }, []);

  const connect = useCallback(
    async (mode: "create" | "join") => {
      const cleanName = displayName.trim();
      if (!cleanName) {
        setError("Enter a display name first.");
        return;
      }
      if (mode === "join" && roomCode.trim().length !== 6) {
        setError("Enter the six-character room code.");
        return;
      }

      setStatus("connecting");
      setError("");
      window.localStorage.setItem("tactics-lite-name", cleanName);
      try {
        const nextRoom =
          mode === "create"
            ? await createTacticsRoom(cleanName)
            : await joinTacticsRoom(roomCode, cleanName);
        attachRoom(nextRoom);
      } catch (connectionError) {
        setStatus("idle");
        setError(errorMessage(connectionError));
      }
    },
    [attachRoom, displayName, roomCode],
  );

  const leaveRoom = useCallback(async () => {
    if (room) {
      await room.leave(true);
    }
    setRoom(undefined);
    setSnapshot(undefined);
    setStatus("idle");
    setError("");
    setNotice("");
    window.history.replaceState({}, "", window.location.pathname);
  }, [room]);

  const copyInvite = useCallback(async () => {
    if (!snapshot?.roomCode) return;
    const url = new URL(window.location.href);
    url.searchParams.set("room", snapshot.roomCode);
    await navigator.clipboard.writeText(url.toString());
    setNotice("Invite link copied.");
    window.setTimeout(() => setNotice(""), 1800);
  }, [snapshot?.roomCode]);

  const handleTileSelected = useCallback(
    ({ x, y }: TileSelection) => {
      if (!room || !snapshot || !isMyTurn) return;
      const ownUnit = snapshot.units.find(
        (unit) => unit.ownerId === localPlayerId,
      );
      if (!ownUnit) return;
      room.send("move", { unitId: ownUnit.id, x, y });
    },
    [isMyTurn, localPlayerId, room, snapshot],
  );

  useEffect(() => {
    return () => {
      void room?.leave(true);
    };
  }, [room]);

  const playerCount = snapshot?.players.length ?? 0;
  const waitingForOpponent = playerCount < 2;
  const subtitle = useMemo(() => {
    if (!snapshot) return "Small grid. Sharp decisions.";
    if (snapshot.status === "waiting") {
      return waitingForOpponent
        ? "Waiting for a second tactician."
        : "Both players must lock in.";
    }
    return isMyTurn ? "Your move." : `${activePlayer?.displayName ?? "Opponent"} is moving.`;
  }, [activePlayer?.displayName, isMyTurn, snapshot, waitingForOpponent]);

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="brand-bar">
        <a className="brand" href="/" aria-label="Tactics Lite home">
          <span className="brand-mark">TL</span>
          <span>
            <strong>Tactics Lite</strong>
            <small>Phase 01 · Proof of Concept</small>
          </span>
        </a>
        <span className={`connection connection-${status}`}>
          <i /> {status === "connected" ? "Live room" : status}
        </span>
      </header>

      {!room ? (
        <section className="landing-grid">
          <div className="hero-copy">
            <span className="eyebrow">Browser tactics · 1 versus 1</span>
            <h1>Every tile should change the plan.</h1>
            <p>
              Create a private room, share the code, and test the first
              server-authoritative movement loop for Tactics Lite.
            </p>
            <div className="feature-strip">
              <span>8 × 8 grid</span>
              <span>2 players</span>
              <span>Zero dice rolls</span>
            </div>
          </div>

          <div className="lobby-card panel">
            <div className="panel-heading">
              <span className="step-number">01</span>
              <div>
                <h2>Enter the operation</h2>
                <p>No account required.</p>
              </div>
            </div>

            <label>
              Display name
              <input
                autoFocus
                maxLength={24}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Your callsign"
                disabled={status === "connecting"}
              />
            </label>

            <button
              className="primary-button"
              onClick={() => void connect("create")}
              disabled={status === "connecting"}
            >
              <span>Create private room</span>
              <b>↗</b>
            </button>

            <div className="divider"><span>or join by code</span></div>

            <div className="join-row">
              <input
                className="code-input"
                maxLength={6}
                value={roomCode}
                onChange={(event) =>
                  setRoomCode(event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase())
                }
                placeholder="ABC123"
                aria-label="Room code"
                disabled={status === "connecting"}
              />
              <button
                className="secondary-button"
                onClick={() => void connect("join")}
                disabled={status === "connecting"}
              >
                Join
              </button>
            </div>
            {error && <p className="message error-message">{error}</p>}
          </div>
        </section>
      ) : (
        <section className="room-layout">
          <div className="room-heading">
            <div>
              <span className="eyebrow">Warehouse · Room {snapshot?.roomCode ?? room.roomId}</span>
              <h1>{subtitle}</h1>
            </div>
            <div className="room-actions">
              <button className="ghost-button" onClick={() => void copyInvite()}>
                Copy invite
              </button>
              <button className="ghost-button danger" onClick={() => void leaveRoom()}>
                Leave
              </button>
            </div>
          </div>

          {snapshot && snapshot.status === "playing" ? (
            <div className="match-grid">
              <div className="board-panel panel">
                <Suspense fallback={<div className="board-loading">Initializing tactical grid…</div>}>
                  <Board
                    snapshot={snapshot}
                    localPlayerId={localPlayerId}
                    onTileSelected={handleTileSelected}
                  />
                </Suspense>
              </div>
              <aside className="match-sidebar">
                <div className="panel turn-panel">
                  <span className="eyebrow">Round {snapshot.currentRound}</span>
                  <h2>{isMyTurn ? "Your turn" : "Opponent's turn"}</h2>
                  <p>
                    {isMyTurn
                      ? "Select your unit, then choose one highlighted tile."
                      : `Waiting for ${activePlayer?.displayName ?? "the opponent"}.`}
                  </p>
                  <div className="move-counter">
                    <span>Moves remaining</span>
                    <strong>{snapshot.movesRemaining}</strong>
                  </div>
                  <button
                    className="secondary-button full-width"
                    disabled={!isMyTurn}
                    onClick={() => room.send("end_turn")}
                  >
                    End turn
                  </button>
                </div>

                <div className="panel roster-panel">
                  <span className="eyebrow">Tactical link</span>
                  {snapshot.players.map((player) => (
                    <div className="roster-entry" key={player.id}>
                      <i className={`player-swatch player-${player.slot}`} />
                      <div>
                        <strong>{player.displayName}</strong>
                        <small>{player.id === localPlayerId ? "You" : "Opponent"}</small>
                      </div>
                      {snapshot.activePlayerId === player.id && <span className="active-tag">Active</span>}
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          ) : (
            <div className="waiting-grid">
              <div className="panel briefing-panel">
                <span className="eyebrow">Ready check</span>
                <h2>Secure both seats.</h2>
                <p>
                  Share the code below. The synchronized board deploys as soon as
                  both players are ready.
                </p>
                <button className="room-code" onClick={() => void copyInvite()}>
                  <span>{snapshot?.roomCode ?? room.roomId}</span>
                  <small>Click to copy invite link</small>
                </button>
              </div>

              <div className="player-slots">
                {[0, 1].map((slot) => {
                  const player = snapshot?.players.find((candidate) => candidate.slot === slot);
                  return (
                    <div className={`panel player-slot player-slot-${slot}`} key={slot}>
                      <span className="slot-label">Player {slot + 1}</span>
                      {player ? (
                        <>
                          <div className="player-orb">{player.displayName.slice(0, 2).toUpperCase()}</div>
                          <h3>{player.displayName}</h3>
                          <span className={player.ready ? "ready-state ready" : "ready-state"}>
                            {player.ready ? "Ready" : "Standing by"}
                          </span>
                          {player.id === localPlayerId && (
                            <button
                              className={player.ready ? "secondary-button full-width" : "primary-button full-width"}
                              onClick={() => room.send("ready")}
                            >
                              {player.ready ? "Cancel ready" : "I'm ready"}
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="player-orb empty">··</div>
                          <h3>Open seat</h3>
                          <span className="ready-state">Awaiting connection</span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(error || notice) && (
            <p className={`toast ${error ? "toast-error" : ""}`}>{error || notice}</p>
          )}
        </section>
      )}
    </main>
  );
}
