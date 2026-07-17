import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ABILITY_DEFINITIONS,
  CLASS_ABILITIES,
  GAME_CONFIG,
  MAP_DEFINITIONS,
  MAP_ORDER,
  type MapId,
  type UnitClassId,
} from "@tactics-lite/game-core";
import {
  playActionSound,
  playOutcomeSound,
  playUiSound,
  setAudioMuted,
  setAudioVolume,
  unlockAudio,
} from "./audio";
import type {
  ActionMode,
  BoardActionEvent,
  BoardSelection,
} from "./game/GameBridge";
import {
  clearReconnectSession,
  createTacticsRoom,
  joinTacticsRoom,
  readReconnectSession,
  reconnectTacticsRoom,
  storeReconnectSession,
  wakeTacticsServer,
  type CpuDifficulty,
  type TacticsRoomConnection,
} from "./multiplayer/client";
import { toMatchSnapshot } from "./multiplayer/snapshot";
import type {
  MatchSnapshot,
  NetworkMatchState,
  UnitSnapshot,
} from "./multiplayer/types";

type ConnectionStatus =
  | "idle"
  | "waking"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "disconnected";

const Board = lazy(() =>
  import("./game/Board").then((module) => ({ default: module.Board })),
);

// Keeps Tab cycling inside an open dialog and restores focus on close.
function useFocusTrap(active: boolean) {
  const containerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return undefined;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusable = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'button, input, a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("disabled"));
    focusable()[0]?.focus();
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (elements.length === 0) return;
      const first = elements[0]!;
      const last = elements[elements.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    container.addEventListener("keydown", handleKeydown);
    return () => {
      container.removeEventListener("keydown", handleKeydown);
      previous?.focus();
    };
  }, [active]);
  return containerRef;
}
const initialRoomCode =
  new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "";
const CPU_OPTIONS: readonly {
  id: CpuDifficulty;
  label: string;
  description: string;
}[] = [
  { id: "easy", label: "Easy", description: "Loose and unpredictable" },
  { id: "normal", label: "Normal", description: "Focused fundamentals" },
  { id: "hard", label: "Hard", description: "Abilities and kill pressure" },
];

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "The room could not be reached.";
}

function connectionLabel(status: ConnectionStatus): string {
  if (status === "connected") return "Live room";
  if (status === "waking") return "Starting server";
  if (status === "reconnecting") return "Reconnecting";
  return status;
}

function actionNotice(payload: {
  type?: string;
  damage?: number;
  eliminated?: boolean;
  apCost?: number;
  abilityName?: string;
}): string {
  if (payload.type === "attack") {
    return payload.eliminated
      ? `Target eliminated · ${payload.damage ?? 0} damage`
      : `${payload.damage ?? 0} damage dealt`;
  }
  if (payload.type === "move") return `Moved · ${payload.apCost ?? 0} AP`;
  if (payload.type === "ability") {
    return `${payload.abilityName ?? "Ability"} · ${payload.apCost ?? 0} AP`;
  }
  if (payload.type === "overwatch") {
    return `Overwatch hit · ${payload.damage ?? 0} damage`;
  }
  return "Action confirmed.";
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
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [actionMode, setActionMode] = useState<ActionMode>("move");
  const [cpuDifficulty, setCpuDifficulty] = useState<CpuDifficulty>("normal");
  const [mapId, setMapId] = useState<MapId>("warehouse");
  const [boardAction, setBoardAction] = useState<BoardActionEvent>();
  const [actionLog, setActionLog] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState<number | null>(null);
  const [muted, setMuted] = useState(
    () => window.localStorage.getItem("tactics-lite-muted") === "true",
  );
  const [volume, setVolume] = useState(
    () => {
      const stored = Number(window.localStorage.getItem("tactics-lite-volume") ?? "0.45");
      return Number.isFinite(stored) ? Math.max(0, Math.min(1, stored)) : 0.45;
    },
  );
  const [reducedMotion, setReducedMotion] = useState(() => {
    const stored = window.localStorage.getItem("tactics-lite-reduced-motion");
    if (stored !== null) return stored === "true";
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  });
  const [highContrast, setHighContrast] = useState(
    () => window.localStorage.getItem("tactics-lite-high-contrast") === "true",
  );
  const actionSequence = useRef(0);
  const attemptedStoredReconnect = useRef(false);

  const localPlayerId = room?.sessionId ?? "";
  const localPlayer = snapshot?.players.find(
    (player) => player.id === localPlayerId,
  );
  const activePlayer = snapshot?.players.find(
    (player) => player.id === snapshot.activePlayerId,
  );
  const selectedUnit = snapshot?.units.find(
    (unit) => unit.id === selectedUnitId,
  );
  const isMyTurn = snapshot?.activePlayerId === localPlayerId;
  const didWin = snapshot?.winnerId === localPlayerId;
  const cpuPlayer = snapshot?.players.find((player) => player.isCpu);
  const isCpuMatch = Boolean(cpuPlayer);
  const isCpuThinking =
    snapshot?.status === "playing" && Boolean(activePlayer?.isCpu);

  const attachRoom = useCallback((nextRoom: TacticsRoomConnection) => {
    storeReconnectSession(nextRoom);
    setRoom(nextRoom);
    setStatus("connected");
    setError("");
    setNotice("");
    setBoardAction(undefined);
    setActionLog([]);
    actionSequence.current = 0;
    setRoomCode(nextRoom.roomId);
    setSnapshot(undefined);
    window.history.replaceState({}, "", `?room=${nextRoom.roomId}`);

    // Colyseus resolves the join before the initial schema collections arrive.
    // Build the first snapshot from onStateChange instead of reading them early.
    const publishState = (state: NetworkMatchState) => {
      setSnapshot(toMatchSnapshot(state));
    };
    nextRoom.onStateChange(publishState);
    publishState(nextRoom.state);
    nextRoom.onMessage("action:error", (payload: { message?: string }) => {
      setError(payload.message ?? "The server rejected that action.");
    });
    nextRoom.onMessage(
      "action:accepted",
      (payload: Omit<BoardActionEvent, "id">) => {
        const event = { ...payload, id: ++actionSequence.current };
        setError("");
        setNotice(actionNotice(payload));
        setBoardAction(event);
        setActionLog((entries) =>
          [actionNotice(payload), ...entries].slice(0, 3),
        );
        playActionSound(payload);
        window.setTimeout(() => setNotice(""), 1400);
      },
    );
    nextRoom.onMessage(
      "match:finished",
      (payload: { winnerId?: string }) => {
        setSelectedUnitId("");
        playOutcomeSound(payload.winnerId === nextRoom.sessionId);
      },
    );
    nextRoom.onMessage(
      "player:reconnecting",
      (payload: { playerId?: string; graceSeconds?: number }) => {
        if (payload.playerId !== nextRoom.sessionId) {
          setNotice(
            `Opponent disconnected · waiting ${payload.graceSeconds ?? 60}s for reconnect`,
          );
        }
      },
    );
    nextRoom.onMessage(
      "player:reconnected",
      (payload: { playerId?: string }) => {
        if (payload.playerId !== nextRoom.sessionId) {
          setNotice("Opponent reconnected.");
          window.setTimeout(() => setNotice(""), 1800);
        }
      },
    );
    nextRoom.onMessage(
      "rematch:updated",
      (payload: { playerId?: string }) => {
        if (payload.playerId !== nextRoom.sessionId) {
          setNotice("Opponent requested a rematch.");
        }
      },
    );
    nextRoom.onDrop(() => {
      setStatus("reconnecting");
      setError("");
      setNotice("Connection interrupted · reconnecting for up to 60 seconds…");
    });
    nextRoom.onReconnect(() => {
      storeReconnectSession(nextRoom);
      setStatus("connected");
      setError("");
      setNotice("Connection restored.");
      window.setTimeout(() => setNotice(""), 1800);
    });
    nextRoom.onLeave(() => {
      setStatus("disconnected");
      setNotice("Reconnect window expired. Retry or return to the lobby.");
    });
  }, []);

  useEffect(() => {
    if (attemptedStoredReconnect.current) return;
    attemptedStoredReconnect.current = true;
    const stored = readReconnectSession();
    if (!stored) return;

    setStatus("reconnecting");
    setRoomCode(stored.roomId);
    void reconnectTacticsRoom(stored.token)
      .then(attachRoom)
      .catch(() => {
        clearReconnectSession();
        setStatus("idle");
        setNotice("");
      });
  }, [attachRoom]);

  const connect = useCallback(
    async (mode: "create" | "cpu" | "join") => {
      const cleanName = displayName.trim();
      if (!cleanName) return setError("Enter a display name first.");
      if (mode === "join" && roomCode.trim().length !== 6) {
        return setError("Enter the six-character room code.");
      }

      clearReconnectSession();
      setStatus("waking");
      setError("");
      window.localStorage.setItem("tactics-lite-name", cleanName);
      try {
        try {
          await wakeTacticsServer();
        } catch {
          // The matchmaking request below is the final connectivity check.
        }
        setStatus("connecting");
        const nextRoom =
          mode === "join"
            ? await joinTacticsRoom(roomCode, cleanName)
            : await createTacticsRoom(
                cleanName,
                mode === "cpu" ? cpuDifficulty : undefined,
                mapId,
              );
        attachRoom(nextRoom);
      } catch (connectionError) {
        setStatus("idle");
        setError(errorMessage(connectionError));
      }
    },
    [attachRoom, cpuDifficulty, displayName, mapId, roomCode],
  );

  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (
      snapshot?.status === "playing" &&
      window.localStorage.getItem("tactics-lite-tutorial-complete") !== "true"
    ) {
      setTutorialStep((step) => step ?? 0);
    }
  }, [snapshot?.status]);

  const updateMuted = useCallback((value: boolean) => {
    setMuted(value);
    setAudioMuted(value);
  }, []);

  const updateVolume = useCallback((value: number) => {
    setVolume(value);
    setAudioVolume(value);
  }, []);

  const updateReducedMotion = useCallback((value: boolean) => {
    setReducedMotion(value);
    window.localStorage.setItem("tactics-lite-reduced-motion", String(value));
  }, []);

  const updateHighContrast = useCallback((value: boolean) => {
    setHighContrast(value);
    window.localStorage.setItem("tactics-lite-high-contrast", String(value));
  }, []);

  const closeTutorial = useCallback(() => {
    window.localStorage.setItem("tactics-lite-tutorial-complete", "true");
    setTutorialStep(null);
  }, []);

  const retryConnection = useCallback(async () => {
    const stored = readReconnectSession();
    if (!stored) {
      setError("The 60-second reconnect window has expired.");
      return;
    }
    setStatus("reconnecting");
    setError("");
    try {
      attachRoom(await reconnectTacticsRoom(stored.token));
    } catch (reconnectError) {
      clearReconnectSession();
      setStatus("disconnected");
      setError(errorMessage(reconnectError));
    }
  }, [attachRoom]);

  const leaveRoom = useCallback(async () => {
    clearReconnectSession();
    if (room && status !== "disconnected") await room.leave(true);
    setRoom(undefined);
    setSnapshot(undefined);
    setSelectedUnitId("");
    setStatus("idle");
    setError("");
    setNotice("");
    setBoardAction(undefined);
    setActionLog([]);
    window.history.replaceState({}, "", window.location.pathname);
  }, [room, status]);

  const copyInvite = useCallback(async () => {
    if (!snapshot?.roomCode) return;
    const url = new URL(window.location.href);
    url.searchParams.set("room", snapshot.roomCode);
    try {
      await navigator.clipboard.writeText(url.toString());
      setNotice("Invite link copied.");
      window.setTimeout(() => setNotice(""), 1800);
    } catch {
      setError(`Copy this room code: ${snapshot.roomCode}`);
    }
  }, [snapshot?.roomCode]);

  const handleBoardSelection = useCallback(
    (selection: BoardSelection) => {
      if (!room || !snapshot || snapshot.status !== "playing") return;

      if (selection.type === "unit") {
        const clickedUnit = snapshot.units.find(
          (unit) => unit.id === selection.unitId,
        );
        if (!clickedUnit?.alive) return;

        const ability =
          actionMode !== "move" && actionMode !== "attack"
            ? ABILITY_DEFINITIONS[actionMode]
            : undefined;
        if (
          isMyTurn &&
          ability &&
          selectedUnit?.alive &&
          clickedUnit.id !== selectedUnit.id &&
          (ability.targetType === "unit" ||
            (ability.targetType === "enemy" &&
              clickedUnit.ownerId !== localPlayerId))
        ) {
          room.send("ability", {
            unitId: selectedUnit.id,
            abilityId: ability.id,
            targetUnitId: clickedUnit.id,
          });
          return;
        }

        if (clickedUnit.ownerId === localPlayerId && !clickedUnit.isDecoy) {
          setSelectedUnitId(clickedUnit.id);
          setError("");
          return;
        }

        if (isMyTurn && actionMode === "attack" && selectedUnit?.alive) {
          room.send("attack", {
            attackerId: selectedUnit.id,
            targetId: clickedUnit.id,
          });
        }
        return;
      }

      if (isMyTurn && actionMode === "move" && selectedUnit?.alive) {
        room.send("move", {
          unitId: selectedUnit.id,
          x: selection.x,
          y: selection.y,
        });
        return;
      }
      if (
        isMyTurn &&
        selectedUnit?.alive &&
        (actionMode === "breach" || actionMode === "decoy")
      ) {
        room.send("ability", {
          unitId: selectedUnit.id,
          abilityId: actionMode,
          x: selection.x,
          y: selection.y,
        });
      }
    },
    [actionMode, isMyTurn, localPlayerId, room, selectedUnit, snapshot],
  );

  useEffect(() => {
    if (!snapshot || snapshot.status !== "playing") return;
    const currentSelection = snapshot.units.find(
      (unit) => unit.id === selectedUnitId,
    );
    if (
      currentSelection?.alive &&
      currentSelection.ownerId === localPlayerId &&
      !currentSelection.isDecoy
    ) {
      return;
    }
    const firstLivingUnit = snapshot.units.find(
      (unit) => unit.ownerId === localPlayerId && unit.alive && !unit.isDecoy,
    );
    setSelectedUnitId(firstLivingUnit?.id ?? "");
  }, [localPlayerId, selectedUnitId, snapshot]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "Escape") {
        setSettingsOpen(false);
        if (tutorialStep !== null) closeTutorial();
        return;
      }
      if (event.key === "?") {
        setTutorialStep(0);
        return;
      }
      if (!snapshot || snapshot.status !== "playing") return;
      const ownUnits = snapshot.units.filter(
        (unit) => unit.ownerId === localPlayerId && unit.alive && !unit.isDecoy,
      );
      const number = Number(event.key);
      if (number >= 1 && number <= 3 && ownUnits[number - 1]) {
        setSelectedUnitId(ownUnits[number - 1]!.id);
      } else if (isMyTurn && event.key.toLowerCase() === "m") {
        setActionMode("move");
      } else if (isMyTurn && event.key.toLowerCase() === "a") {
        setActionMode("attack");
      } else if (isMyTurn && event.key.toLowerCase() === "e") {
        room?.send("end_turn");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [closeTutorial, isMyTurn, localPlayerId, room, snapshot, tutorialStep]);

  const handleActionMode = useCallback(
    (mode: ActionMode) => {
      if (
        room &&
        selectedUnit?.alive &&
        mode !== "move" &&
        mode !== "attack" &&
        ABILITY_DEFINITIONS[mode].targetType === "self"
      ) {
        room.send("ability", { unitId: selectedUnit.id, abilityId: mode });
        return;
      }
      setActionMode(mode);
    },
    [room, selectedUnit],
  );

  useEffect(() => {
    if (actionMode === "move" || actionMode === "attack") return;
    const ability = ABILITY_DEFINITIONS[actionMode];
    if (
      !selectedUnit ||
      selectedUnit.classId !== ability.classId ||
      (selectedUnit.cooldowns[actionMode] ?? 0) > 0
    ) {
      setActionMode("move");
    }
  }, [actionMode, selectedUnit]);

  const playerCount = snapshot?.players.length ?? 0;
  const subtitle = useMemo(() => {
    if (!snapshot) return "Small grid. Sharp decisions.";
    if (snapshot.status === "waiting") {
      return playerCount < 2
        ? "Waiting for a second tactician."
        : "Both players must lock in.";
    }
    if (snapshot.status === "finished") {
      return didWin ? "Warehouse secured." : "Your squad was eliminated.";
    }
    return isMyTurn
      ? "Spend six points. Break their formation."
      : `${activePlayer?.displayName ?? "Opponent"} is moving.`;
  }, [activePlayer?.displayName, didWin, isMyTurn, playerCount, snapshot]);

  return (
    <main
      className={`app-shell ${reducedMotion ? "reduced-motion" : ""} ${
        highContrast ? "high-contrast" : ""
      }`}
    >
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="brand-bar">
        <a className="brand" href="/" aria-label="Tactics Lite home">
          <span className="brand-mark">TL</span>
          <span>
            <strong>Tactics Lite</strong>
            <small>Phase 07 · Complete Operation</small>
          </span>
        </a>
        <div className="brand-tools">
          <button
            className="icon-button"
            type="button"
            aria-label="Open tutorial"
            onClick={() => setTutorialStep(0)}
          >
            ?
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Open settings"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙
          </button>
          <span className={`connection connection-${status}`}>
            <i /> {connectionLabel(status)}
          </span>
        </div>
      </header>

      {!room && status === "reconnecting" ? (
        <ConnectionRecovery error={error} onRetry={retryConnection} />
      ) : !room ? (
        <Landing
          displayName={displayName}
          roomCode={roomCode}
          status={status}
          error={error}
          cpuDifficulty={cpuDifficulty}
          mapId={mapId}
          onDisplayName={setDisplayName}
          onRoomCode={setRoomCode}
          onCpuDifficulty={setCpuDifficulty}
          onMapId={setMapId}
          onConnect={connect}
        />
      ) : (
        <section className="room-layout">
          <div className="room-heading">
            <div>
              <span className="eyebrow">
                {isCpuMatch
                  ? `${MAP_DEFINITIONS[snapshot?.mapId ?? mapId].name} · Solo vs ${cpuPlayer?.difficulty ?? "CPU"}`
                  : `${MAP_DEFINITIONS[snapshot?.mapId ?? mapId].name} · Room ${snapshot?.roomCode ?? room.roomId}`}
              </span>
              <h1>{subtitle}</h1>
            </div>
            <div className="room-actions">
              {!isCpuMatch && (
                <button className="ghost-button" onClick={() => void copyInvite()}>
                  Copy invite
                </button>
              )}
              <button
                className="ghost-button danger"
                onClick={() => void leaveRoom()}
              >
                Leave
              </button>
            </div>
          </div>

          {snapshot && snapshot.status !== "waiting" ? (
            <div className="match-grid">
              <div className="board-panel panel">
                <div className="board-stage">
                  <Suspense
                    fallback={
                      <div className="board-loading">
                        Initializing tactical grid…
                      </div>
                    }
                  >
                    <Board
                      snapshot={snapshot}
                      localPlayerId={localPlayerId}
                      selectedUnitId={selectedUnitId}
                      actionMode={actionMode}
                      reducedMotion={reducedMotion}
                      actionEvent={boardAction}
                      onSelection={handleBoardSelection}
                    />
                  </Suspense>
                  {snapshot.status === "playing" && (
                    <div
                      className={
                        isMyTurn
                          ? "turn-banner turn-banner-local"
                          : "turn-banner turn-banner-opponent"
                      }
                      key={`${snapshot.currentRound}-${snapshot.activePlayerId}`}
                    >
                      <small>Round {snapshot.currentRound}</small>
                      <strong>
                        {isMyTurn
                          ? "Your turn"
                          : activePlayer?.isCpu
                            ? "CPU turn"
                            : "Opponent turn"}
                      </strong>
                    </div>
                  )}
                  {isCpuThinking && (
                    <div className="cpu-thinking">
                      <i /><span>CPU is thinking…</span>
                    </div>
                  )}
                  {snapshot.status === "finished" && (
                    <div
                      className={
                        didWin
                          ? "match-outcome-overlay victory"
                          : "match-outcome-overlay defeat"
                      }
                    >
                      <small>Operation complete</small>
                      <strong>{didWin ? "Victory" : "Defeat"}</strong>
                    </div>
                  )}
                </div>
              </div>
              <MatchSidebar
                snapshot={snapshot}
                localPlayerId={localPlayerId}
                selectedUnit={selectedUnit}
                actionMode={actionMode}
                isMyTurn={isMyTurn}
                didWin={didWin}
                isCpuThinking={isCpuThinking}
                actionLog={actionLog}
                onActionMode={handleActionMode}
                onSelectUnit={setSelectedUnitId}
                onEndTurn={() => room.send("end_turn")}
                onRematch={() => room.send("rematch")}
                onSurrender={() => {
                  if (window.confirm("Surrender this match?")) room.send("surrender");
                }}
                onLeave={() => void leaveRoom()}
              />
            </div>
          ) : (
            <WaitingRoom
              snapshot={snapshot}
              roomId={room.roomId}
              localPlayerId={localPlayerId}
              onCopy={copyInvite}
              onReady={() => room.send("ready")}
            />
          )}

          {(error || notice) && (
            <p
              className={`toast ${error ? "toast-error" : ""}`}
              role={error ? "alert" : "status"}
            >
              {error || notice}
            </p>
          )}
          {(status === "reconnecting" || status === "disconnected") && (
            <div className="connection-recovery-overlay">
              <div className="panel connection-recovery-card">
                <span className="reconnect-spinner" />
                <span className="eyebrow">
                  {status === "reconnecting" ? "Reconnecting" : "Connection lost"}
                </span>
                <h2>
                  {status === "reconnecting"
                    ? "Holding your place in the match."
                    : "The reconnect window may have expired."}
                </h2>
                <p>
                  Your seat is reserved for up to 60 seconds after a network interruption.
                </p>
                <div>
                  <button
                    className="primary-button"
                    onClick={() => void retryConnection()}
                    disabled={status === "reconnecting"}
                  >
                    Retry connection
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => void leaveRoom()}
                  >
                    Return to lobby
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}
      {settingsOpen && (
        <SettingsDialog
          muted={muted}
          volume={volume}
          reducedMotion={reducedMotion}
          highContrast={highContrast}
          onMuted={updateMuted}
          onVolume={updateVolume}
          onReducedMotion={updateReducedMotion}
          onHighContrast={updateHighContrast}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {tutorialStep !== null && (
        <TutorialDialog
          step={tutorialStep}
          onStep={setTutorialStep}
          onClose={closeTutorial}
        />
      )}
    </main>
  );
}

interface LandingProps {
  displayName: string;
  roomCode: string;
  status: ConnectionStatus;
  error: string;
  cpuDifficulty: CpuDifficulty;
  mapId: MapId;
  onDisplayName(value: string): void;
  onRoomCode(value: string): void;
  onCpuDifficulty(value: CpuDifficulty): void;
  onMapId(value: MapId): void;
  onConnect(mode: "create" | "cpu" | "join"): Promise<void>;
}

function Landing(props: LandingProps) {
  const isBusy = props.status === "connecting" || props.status === "waking";
  return (
    <section className="landing-grid">
      <div className="hero-copy">
        <span className="eyebrow">Browser tactics · 1 versus 1</span>
        <h1>Six units. Six points. No wasted moves.</h1>
        <p>
          Position a Breacher, Sniper, and Trickster through deterministic
          firefights on a compact warehouse grid.
        </p>
        <div className="feature-strip">
          <span>3 units each</span>
          <span>6 AP turns</span>
          <span>Deterministic combat</span>
        </div>
      </div>

      <div className="lobby-card panel">
        <div className="panel-heading">
          <span className="step-number">01</span>
          <div>
            <h2>Choose your operation</h2>
            <p>One callsign. Two ways to deploy.</p>
          </div>
        </div>
        <label>
          Display name
          <input
            autoFocus
            maxLength={24}
            value={props.displayName}
            onChange={(event) => props.onDisplayName(event.target.value)}
            placeholder="Your callsign"
            disabled={isBusy}
          />
        </label>
        <div className="map-picker" aria-label="Battlefield">
          <span>Battlefield</span>
          <div className="map-options">
            {MAP_ORDER.map((id) => {
              const map = MAP_DEFINITIONS[id];
              return (
                <button
                  type="button"
                  className={props.mapId === id ? "map-option selected" : "map-option"}
                  onClick={() => props.onMapId(id)}
                  disabled={isBusy}
                  key={id}
                >
                  <strong>{map.name}</strong>
                  <small>{map.description}</small>
                </button>
              );
            })}
          </div>
        </div>
        <div className="mode-cards">
          <article className="mode-card solo-mode">
            <div className="mode-card-heading">
              <span className="mode-icon">◎</span>
              <div>
                <small>Solo operation</small>
                <h3>Outthink the CPU</h3>
              </div>
            </div>
            <p>Deploy instantly against a server-controlled squad.</p>
            <div className="difficulty-picker">
              <span>Difficulty</span>
              <div className="difficulty-options">
                {CPU_OPTIONS.map((option) => (
                  <button
                    type="button"
                    className={
                      props.cpuDifficulty === option.id
                        ? "difficulty-option selected"
                        : "difficulty-option"
                    }
                    onClick={() => props.onCpuDifficulty(option.id)}
                    disabled={isBusy}
                    key={option.id}
                  >
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </button>
                ))}
              </div>
            </div>
            <button
              className="primary-button"
              onClick={() => void props.onConnect("cpu")}
              disabled={isBusy}
            >
              <span>Start solo operation</span>
              <b>▶</b>
            </button>
          </article>

          <article className="mode-card duel-mode">
            <div className="mode-card-heading">
              <span className="mode-icon">◇</span>
              <div>
                <small>Private duel</small>
                <h3>Challenge a friend</h3>
              </div>
            </div>
            <p>Create a private room or enter an existing operation code.</p>
            <button
              className="secondary-button full-width"
              onClick={() => void props.onConnect("create")}
              disabled={isBusy}
            >
              Create private room
            </button>
            <div className="divider">
              <span>or join by code</span>
            </div>
            <div className="join-row">
              <input
                className="code-input"
                maxLength={6}
                value={props.roomCode}
                onChange={(event) =>
                  props.onRoomCode(
                    event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase(),
                  )
                }
                placeholder="ABC123"
                aria-label="Room code"
                disabled={isBusy}
              />
              <button
                className="secondary-button"
                onClick={() => void props.onConnect("join")}
                disabled={isBusy}
              >
                Join
              </button>
            </div>
          </article>
        </div>
        {props.status === "waking" && (
          <p className="server-waking-message">
            Starting the free game server… the first connection after an idle period can take up to a minute.
          </p>
        )}
        {props.error && (
          <p className="message error-message">{props.error}</p>
        )}
      </div>
    </section>
  );
}

function ConnectionRecovery(props: {
  error: string;
  onRetry(): Promise<void>;
}) {
  return (
    <section className="standalone-recovery">
      <div className="panel connection-recovery-card">
        <span className="reconnect-spinner" />
        <span className="eyebrow">Restoring session</span>
        <h1>Rejoining your operation.</h1>
        <p>
          The server keeps your seat for 60 seconds after a reload or short network interruption.
        </p>
        {props.error && <p className="message error-message">{props.error}</p>}
        <button className="primary-button" onClick={() => void props.onRetry()}>
          Retry now
        </button>
      </div>
    </section>
  );
}

interface WaitingRoomProps {
  snapshot?: MatchSnapshot;
  roomId: string;
  localPlayerId: string;
  onCopy(): Promise<void>;
  onReady(): void;
}

function WaitingRoom(props: WaitingRoomProps) {
  const cpuPlayer = props.snapshot?.players.find((player) => player.isCpu);
  return (
    <div className="waiting-grid">
      <div className="panel briefing-panel">
        <span className="eyebrow">
          {cpuPlayer ? "Solo operation" : "Ready check"}
        </span>
        <h2>{cpuPlayer ? `Challenge the ${cpuPlayer.difficulty} CPU.` : "Deploy both squads."}</h2>
        <p>
          Each player receives a Breacher, Sniper, and Trickster. Eliminate all
          three opposing units to win.
        </p>
        {cpuPlayer ? (
          <div className="cpu-summary">
            <span>{cpuPlayer.displayName}</span>
            <small>Server-controlled opponent · Ready when you are</small>
          </div>
        ) : (
          <button className="room-code" onClick={() => void props.onCopy()}>
            <span>{props.snapshot?.roomCode ?? props.roomId}</span>
            <small>Click to copy invite link</small>
          </button>
        )}
      </div>

      <div className="player-slots">
        {[0, 1].map((slot) => {
          const player = props.snapshot?.players.find(
            (candidate) => candidate.slot === slot,
          );
          return (
            <div className={`panel player-slot player-slot-${slot}`} key={slot}>
              <span className="slot-label">
                {player?.isCpu ? "CPU opponent" : `Player ${slot + 1}`}
              </span>
              {player ? (
                <>
                  <div className={player.isCpu ? "player-orb cpu" : "player-orb"}>
                    {player.displayName.slice(0, 2).toUpperCase()}
                  </div>
                  <h3>{player.displayName}</h3>
                  <span
                    className={
                      player.ready ? "ready-state ready" : "ready-state"
                    }
                  >
                    {player.isCpu
                      ? `${player.difficulty} difficulty`
                      : player.ready
                        ? "Ready"
                        : "Standing by"}
                  </span>
                  {player.id === props.localPlayerId && (
                    <button
                      className={
                        player.ready
                          ? "secondary-button full-width"
                          : "primary-button full-width"
                      }
                      onClick={props.onReady}
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
  );
}

interface MatchSidebarProps {
  snapshot: MatchSnapshot;
  localPlayerId: string;
  selectedUnit?: UnitSnapshot;
  actionMode: ActionMode;
  isMyTurn: boolean;
  didWin: boolean;
  isCpuThinking: boolean;
  actionLog: string[];
  onActionMode(mode: ActionMode): void;
  onSelectUnit(unitId: string): void;
  onEndTurn(): void;
  onRematch(): void;
  onSurrender(): void;
  onLeave(): void;
}

function MatchSidebar(props: MatchSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const sidebarToggle = (
    <button
      className="sidebar-toggle"
      type="button"
      onClick={() => setIsOpen((open) => !open)}
      aria-expanded={isOpen}
      aria-controls="squad-panel action-log-panel"
    >
      <span>{isOpen ? "Hide squad & battle log" : "Squad & battle log"}</span>
      <b>{isOpen ? "×" : "⌃"}</b>
    </button>
  );

  if (props.snapshot.status === "finished") {
    const winner = props.snapshot.players.find(
      (player) => player.id === props.snapshot.winnerId,
    );
    const localPlayer = props.snapshot.players.find(
      (player) => player.id === props.localPlayerId,
    );
    return (
      <aside className={`match-sidebar ${isOpen ? "open" : ""}`}>
        <div className={`panel result-panel ${props.didWin ? "victory" : "defeat"}`}>
          <span className="eyebrow">Match complete</span>
          <div className="result-icon">{props.didWin ? "V" : "×"}</div>
          <h2>{props.didWin ? "Victory" : "Defeat"}</h2>
          <p>
            {winner?.displayName ?? "The opposing squad"} secured {" "}
            {MAP_DEFINITIONS[props.snapshot.mapId].name}
            {props.snapshot.winReason === "surrender" ? " by surrender" : ""}.
          </p>
          <div className="result-stats">
            {props.snapshot.players.map((player) => {
              const stats = props.snapshot.stats.find(
                (entry) => entry.playerId === player.id,
              );
              return (
                <div key={player.id}>
                  <strong>{player.displayName}</strong>
                  <span>{stats?.damageDealt ?? 0} damage</span>
                  <span>{stats?.unitsEliminated ?? 0} eliminations</span>
                  <span>{stats?.abilitiesUsed ?? 0} abilities</span>
                  <span>{stats?.apSpent ?? 0} AP spent</span>
                </div>
              );
            })}
          </div>
          <button
            className="primary-button full-width"
            onClick={props.onRematch}
            disabled={localPlayer?.rematchReady}
          >
            {localPlayer?.rematchReady ? "Waiting for opponent…" : "Play rematch"}
          </button>
          <button className="secondary-button full-width" onClick={props.onLeave}>
            Return to lobby
          </button>
        </div>
        {sidebarToggle}
        <SquadPanel {...props} />
        <ActionLog entries={props.actionLog} />
      </aside>
    );
  }

  return (
    <aside className={`match-sidebar ${isOpen ? "open" : ""}`}>
      <div className="panel turn-panel">
        <div className="turn-heading-row">
          <span className="eyebrow">Round {props.snapshot.currentRound}</span>
          <span className={props.isMyTurn ? "turn-live" : "turn-wait"}>
            {props.isMyTurn ? "Your turn" : "Opponent"}
          </span>
        </div>
        {props.isCpuThinking && (
          <div className="thinking-status">
            <i /> CPU is thinking…
          </div>
        )}
        <div className="ap-display">
          <strong
            className="ap-number"
            key={props.snapshot.actionPointsRemaining}
          >
            {props.snapshot.actionPointsRemaining}
          </strong>
          <div>
            <span>Action points</span>
            <div className="ap-pips">
              {Array.from(
                { length: GAME_CONFIG.actions.actionPointsPerTurn },
                (_, index) => (
                  <i
                    className={
                      index < props.snapshot.actionPointsRemaining ? "filled" : ""
                    }
                    key={index}
                  />
                ),
              )}
            </div>
          </div>
        </div>

        {props.selectedUnit ? (
          <div className="unit-card">
            <div className="unit-card-heading">
              <span className={`class-badge ${props.selectedUnit.classId}`}>
                {classIcon(props.selectedUnit.classId)}
              </span>
              <div>
                <h2>{props.selectedUnit.name}</h2>
                <small>{props.selectedUnit.classId}</small>
              </div>
              <strong>
                {props.selectedUnit.hp}/{props.selectedUnit.maxHp} HP
              </strong>
            </div>
            <div className="unit-hp-track">
              <i
                style={{
                  width: `${(props.selectedUnit.hp / props.selectedUnit.maxHp) * 100}%`,
                }}
              />
            </div>
            <div className="unit-stats">
              <span>Move <b>{props.selectedUnit.movementRange}</b></span>
              <span>Range <b>{props.selectedUnit.attackRange}</b></span>
              <span>Damage <b>{props.selectedUnit.attackDamage}</b></span>
            </div>
          </div>
        ) : (
          <p className="empty-selection">Select one of your living units.</p>
        )}

        <div className="action-buttons">
          <button
            className={props.actionMode === "move" ? "action-button active" : "action-button"}
            disabled={!props.isMyTurn || !props.selectedUnit?.alive}
            onClick={() => props.onActionMode("move")}
          >
            <b>Move</b>
            <small>1 AP / tile</small>
            <span className="action-tooltip">Choose a highlighted tile. Hover to preview the path and AP cost. Shortcut: M.</span>
          </button>
          <button
            className={props.actionMode === "attack" ? "action-button active attack" : "action-button attack"}
            disabled={
              !props.isMyTurn ||
              !props.selectedUnit?.alive ||
              props.snapshot.actionPointsRemaining <
                GAME_CONFIG.actions.standardAttackCost
            }
            onClick={() => props.onActionMode("attack")}
          >
            <b>Attack</b>
            <small>{GAME_CONFIG.actions.standardAttackCost} AP</small>
            <span className="action-tooltip">Fire at a highlighted enemy. Damage and cover are shown on hover. Shortcut: A.</span>
          </button>
          {props.selectedUnit &&
            isCombatClass(props.selectedUnit.classId) &&
            CLASS_ABILITIES[props.selectedUnit.classId].map((abilityId) => {
              const ability = ABILITY_DEFINITIONS[abilityId];
              const cooldown = props.selectedUnit?.cooldowns[abilityId] ?? 0;
              const unavailable =
                !props.isMyTurn ||
                !props.selectedUnit?.alive ||
                cooldown > 0 ||
                props.snapshot.actionPointsRemaining < ability.actionPointCost;
              return (
                <button
                  className={
                    props.actionMode === abilityId
                      ? "action-button ability active"
                      : "action-button ability"
                  }
                  disabled={unavailable}
                  onClick={() => props.onActionMode(abilityId)}
                  title={ability.description}
                  key={abilityId}
                >
                  <b>{ability.name}</b>
                  <small>
                    {cooldown > 0
                      ? `Cooldown ${cooldown}`
                      : `${ability.actionPointCost} AP · R${ability.range}`}
                  </small>
                  {cooldown > 0 && (
                    <span className="cooldown-badge" aria-label={`${cooldown} rounds cooldown`}>
                      {cooldown}
                    </span>
                  )}
                  <span className="action-tooltip">{ability.description}</span>
                </button>
              );
            })}
        </div>
        {props.selectedUnit && isCombatClass(props.selectedUnit.classId) && (
          <p className="passive-note">{passiveText(props.selectedUnit.classId)}</p>
        )}
        <button
          className="secondary-button full-width"
          disabled={!props.isMyTurn}
          onClick={props.onEndTurn}
        >
          End turn
        </button>
        <button className="text-button danger" onClick={props.onSurrender}>
          Surrender match
        </button>
      </div>
      {sidebarToggle}
      <SquadPanel {...props} />
      <ActionLog entries={props.actionLog} />
    </aside>
  );
}

function SquadPanel(props: MatchSidebarProps) {
  const ownUnits = props.snapshot.units.filter(
    (unit) => unit.ownerId === props.localPlayerId && !unit.isDecoy,
  );
  return (
    <div className="panel roster-panel" id="squad-panel">
      <span className="eyebrow">Your squad</span>
      {ownUnits.map((unit) => (
        <button
          className={`squad-entry ${
            props.selectedUnit?.id === unit.id ? "selected" : ""
          } ${!unit.alive ? "eliminated" : ""}`}
          key={unit.id}
          onClick={() => unit.alive && props.onSelectUnit(unit.id)}
          disabled={!unit.alive}
        >
          <i className={`class-icon-small ${unit.classId}`}>
            {classIcon(unit.classId)}
          </i>
          <span>
            <strong>{unit.name}</strong>
            <small>{unit.hp}/{unit.maxHp} HP</small>
          </span>
          <b>{unit.alive ? "›" : "OUT"}</b>
        </button>
      ))}
    </div>
  );
}

function ActionLog({ entries }: { entries: string[] }) {
  return (
    <div className="panel action-log-panel" id="action-log-panel">
      <span className="eyebrow">Recent actions</span>
      {entries.length > 0 ? (
        <ol>
          {entries.map((entry, index) => (
            <li key={`${entry}-${index}`}>
              <i /> <span>{entry}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p>Actions from both squads will appear here.</p>
      )}
    </div>
  );
}

const TUTORIAL_STEPS = [
  {
    title: "Your mission",
    text: "Tactics Lite is a turn-based duel on an 8 x 8 grid. You command the three teal operators; your opponent commands the red ones. You take turns — in your turn you move, shoot, and use abilities. Eliminate all three enemy operators before they eliminate yours.",
    tip: "You can reopen this training at any time with the ? button in the top bar.",
    icon: "01",
  },
  {
    title: "Select an operator",
    text: "Click or tap one of your glowing teal operators on the board, or pick one from the squad list. A white ring marks who is selected. Everything you order — moving, attacking, abilities — applies to that operator until you select another one.",
    tip: "Keyboard: press 1, 2, or 3 to jump between your operators.",
    icon: "02",
  },
  {
    title: "Spend six action points",
    text: "Each turn your whole squad shares 6 action points (AP) — the big number next to the board. Moving costs 1 AP per tile, a standard attack costs 2 AP, and every ability shows its own price on its button. Done or out of points? Press End turn to hand over.",
    tip: "Unspent AP are lost when your turn ends, so make them count.",
    icon: "03",
  },
  {
    title: "Move across the grid",
    text: "With Move selected, every tile you can reach lights up — click one and your operator walks there. On a computer, hovering a tile previews the exact path and AP cost first. On a touchscreen, your first tap shows that preview and tapping the same tile again confirms the move.",
    tip: "Keyboard: M switches to Move mode.",
    icon: "04",
  },
  {
    title: "Attack from cover",
    text: "Switch to Attack and pick a highlighted enemy. The preview shows exactly how much damage you will deal before you commit. Wooden barriers are low cover — standing directly behind one means you take less damage. Solid crates block shots completely; nobody can shoot through them.",
    tip: "Keyboard: A switches to Attack mode.",
    icon: "05",
  },
  {
    title: "Unleash abilities",
    text: "Every operator has two special abilities below Move and Attack, each with an AP cost and a cooldown. The Breacher shoves enemies and smashes cover, the Sniper hits across the map and sets Overwatch (an automatic reaction shot at enemies that move in sight), and the Trickster swaps positions and drops decoys.",
    tip: "Hover or focus an ability button to read exactly what it does.",
    icon: "06",
  },
  {
    title: "Break their formation",
    text: "Win by eliminating all three red operators. The recent-actions log next to the board tells you what just happened, and the passive note under your buttons reminds you of your operator's built-in strength. That is everything you need — good hunting.",
    tip: "Keyboard: E ends your turn.",
    icon: "07",
  },
] as const;

function TutorialDialog(props: {
  step: number;
  onStep(step: number): void;
  onClose(): void;
}) {
  const current = TUTORIAL_STEPS[props.step] ?? TUTORIAL_STEPS[0];
  const isLast = props.step >= TUTORIAL_STEPS.length - 1;
  const trapRef = useFocusTrap(true);
  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={trapRef} className="panel modal-card tutorial-card" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
        <span className="tutorial-number">{current.icon}</span>
        <span className="eyebrow">Quick training · {props.step + 1}/{TUTORIAL_STEPS.length}</span>
        <h2 id="tutorial-title">{current.title}</h2>
        <p>{current.text}</p>
        <p className="tutorial-tip"><b>Tip</b><span>{current.tip}</span></p>
        <div className="tutorial-progress">
          {TUTORIAL_STEPS.map((_, index) => (
            <i className={index <= props.step ? "active" : ""} key={index} />
          ))}
        </div>
        <div className={`modal-actions ${props.step > 0 ? "with-back" : ""}`}>
          <button className="ghost-button" onClick={props.onClose}>Skip tutorial</button>
          {props.step > 0 && (
            <button
              className="ghost-button"
              onClick={() => {
                playUiSound();
                props.onStep(props.step - 1);
              }}
            >
              Back
            </button>
          )}
          <button
            className="primary-button"
            onClick={() => {
              playUiSound();
              if (isLast) props.onClose();
              else props.onStep(props.step + 1);
            }}
          >
            {isLast ? "Start operation" : "Next"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingsDialog(props: {
  muted: boolean;
  volume: number;
  reducedMotion: boolean;
  highContrast: boolean;
  onMuted(value: boolean): void;
  onVolume(value: number): void;
  onReducedMotion(value: boolean): void;
  onHighContrast(value: boolean): void;
  onClose(): void;
}) {
  const trapRef = useFocusTrap(true);
  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={trapRef} className="panel modal-card settings-card" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <span className="eyebrow">Preferences</span>
        <h2 id="settings-title">Game settings</h2>
        <label className="setting-row">
          <span><strong>Sound effects</strong><small>Movement, weapons, abilities, and outcomes</small></span>
          <input type="checkbox" checked={!props.muted} onChange={(event) => props.onMuted(!event.target.checked)} />
        </label>
        <label className="setting-row setting-slider">
          <span><strong>Volume</strong><small>{Math.round(props.volume * 100)}%</small></span>
          <input aria-label="Sound volume" type="range" min="0" max="1" step="0.05" value={props.volume} disabled={props.muted} onChange={(event) => props.onVolume(Number(event.target.value))} />
        </label>
        <label className="setting-row">
          <span><strong>Reduce motion</strong><small>Minimizes pulses, banners, and ambient movement</small></span>
          <input type="checkbox" checked={props.reducedMotion} onChange={(event) => props.onReducedMotion(event.target.checked)} />
        </label>
        <label className="setting-row">
          <span><strong>High contrast</strong><small>Strengthens outlines and team differentiation</small></span>
          <input type="checkbox" checked={props.highContrast} onChange={(event) => props.onHighContrast(event.target.checked)} />
        </label>
        <button className="primary-button full-width" onClick={props.onClose}>Done</button>
      </section>
    </div>
  );
}

function isCombatClass(classId: string): classId is UnitClassId {
  return (
    classId === "breacher" || classId === "sniper" || classId === "trickster"
  );
}

function classIcon(classId: string): string {
  if (classId === "breacher") return "⬢";
  if (classId === "sniper") return "⌖";
  if (classId === "trickster") return "◇";
  return "◈";
}

function passiveText(classId: UnitClassId): string {
  if (classId === "breacher") {
    return "Passive · Takes 1 less damage from adjacent attackers.";
  }
  if (classId === "sniper") {
    return "Passive · Deals +1 damage at distance 4 or more.";
  }
  return "Passive · First movement each turn costs 1 AP less.";
}
