import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ABILITY_DEFINITIONS,
  CLASS_ABILITIES,
  GAME_CONFIG,
  type UnitClassId,
} from "@tactics-lite/game-core";
import type {
  ActionMode,
  BoardSelection,
} from "./game/GameBridge";
import {
  createTacticsRoom,
  joinTacticsRoom,
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
  | "connecting"
  | "connected"
  | "disconnected";

const Board = lazy(() =>
  import("./game/Board").then((module) => ({ default: module.Board })),
);
const initialRoomCode =
  new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "The room could not be reached.";
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

  const attachRoom = useCallback((nextRoom: TacticsRoomConnection) => {
    setRoom(nextRoom);
    setStatus("connected");
    setError("");
    setNotice("");
    setRoomCode(nextRoom.roomId);
    setSnapshot(toMatchSnapshot(nextRoom.state));
    window.history.replaceState({}, "", `?room=${nextRoom.roomId}`);

    nextRoom.onStateChange((state: NetworkMatchState) => {
      setSnapshot(toMatchSnapshot(state));
    });
    nextRoom.onMessage("action:error", (payload: { message?: string }) => {
      setError(payload.message ?? "The server rejected that action.");
    });
    nextRoom.onMessage(
      "action:accepted",
      (payload: {
        type?: string;
        damage?: number;
        eliminated?: boolean;
        apCost?: number;
        abilityName?: string;
      }) => {
        setError("");
        setNotice(actionNotice(payload));
        window.setTimeout(() => setNotice(""), 1400);
      },
    );
    nextRoom.onMessage("match:finished", () => setSelectedUnitId(""));
    nextRoom.onLeave(() => {
      setStatus("disconnected");
      setNotice("Connection closed. Return to the lobby to start again.");
    });
  }, []);

  const connect = useCallback(
    async (mode: "create" | "join") => {
      const cleanName = displayName.trim();
      if (!cleanName) return setError("Enter a display name first.");
      if (mode === "join" && roomCode.trim().length !== 6) {
        return setError("Enter the six-character room code.");
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
    if (room) await room.leave(true);
    setRoom(undefined);
    setSnapshot(undefined);
    setSelectedUnitId("");
    setStatus("idle");
    setError("");
    setNotice("");
    window.history.replaceState({}, "", window.location.pathname);
  }, [room]);

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

  useEffect(() => {
    return () => {
      void room?.leave(true);
    };
  }, [room]);

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
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="brand-bar">
        <a className="brand" href="/" aria-label="Tactics Lite home">
          <span className="brand-mark">TL</span>
          <span>
            <strong>Tactics Lite</strong>
            <small>Phase 03 · Signature Abilities</small>
          </span>
        </a>
        <span className={`connection connection-${status}`}>
          <i /> {status === "connected" ? "Live room" : status}
        </span>
      </header>

      {!room ? (
        <Landing
          displayName={displayName}
          roomCode={roomCode}
          status={status}
          error={error}
          onDisplayName={setDisplayName}
          onRoomCode={setRoomCode}
          onConnect={connect}
        />
      ) : (
        <section className="room-layout">
          <div className="room-heading">
            <div>
              <span className="eyebrow">
                Warehouse · Room {snapshot?.roomCode ?? room.roomId}
              </span>
              <h1>{subtitle}</h1>
            </div>
            <div className="room-actions">
              <button className="ghost-button" onClick={() => void copyInvite()}>
                Copy invite
              </button>
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
                    onSelection={handleBoardSelection}
                  />
                </Suspense>
              </div>
              <MatchSidebar
                snapshot={snapshot}
                localPlayerId={localPlayerId}
                selectedUnit={selectedUnit}
                actionMode={actionMode}
                isMyTurn={isMyTurn}
                didWin={didWin}
                onActionMode={handleActionMode}
                onSelectUnit={setSelectedUnitId}
                onEndTurn={() => room.send("end_turn")}
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
            <p className={`toast ${error ? "toast-error" : ""}`}>
              {error || notice}
            </p>
          )}
        </section>
      )}
    </main>
  );
}

interface LandingProps {
  displayName: string;
  roomCode: string;
  status: ConnectionStatus;
  error: string;
  onDisplayName(value: string): void;
  onRoomCode(value: string): void;
  onConnect(mode: "create" | "join"): Promise<void>;
}

function Landing(props: LandingProps) {
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
          <span className="step-number">02</span>
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
            value={props.displayName}
            onChange={(event) => props.onDisplayName(event.target.value)}
            placeholder="Your callsign"
            disabled={props.status === "connecting"}
          />
        </label>
        <button
          className="primary-button"
          onClick={() => void props.onConnect("create")}
          disabled={props.status === "connecting"}
        >
          <span>Create private room</span>
          <b>↗</b>
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
            disabled={props.status === "connecting"}
          />
          <button
            className="secondary-button"
            onClick={() => void props.onConnect("join")}
            disabled={props.status === "connecting"}
          >
            Join
          </button>
        </div>
        {props.error && (
          <p className="message error-message">{props.error}</p>
        )}
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
  return (
    <div className="waiting-grid">
      <div className="panel briefing-panel">
        <span className="eyebrow">Ready check</span>
        <h2>Deploy both squads.</h2>
        <p>
          Each player receives a Breacher, Sniper, and Trickster. Eliminate all
          three opposing units to win.
        </p>
        <button className="room-code" onClick={() => void props.onCopy()}>
          <span>{props.snapshot?.roomCode ?? props.roomId}</span>
          <small>Click to copy invite link</small>
        </button>
      </div>

      <div className="player-slots">
        {[0, 1].map((slot) => {
          const player = props.snapshot?.players.find(
            (candidate) => candidate.slot === slot,
          );
          return (
            <div className={`panel player-slot player-slot-${slot}`} key={slot}>
              <span className="slot-label">Player {slot + 1}</span>
              {player ? (
                <>
                  <div className="player-orb">
                    {player.displayName.slice(0, 2).toUpperCase()}
                  </div>
                  <h3>{player.displayName}</h3>
                  <span
                    className={
                      player.ready ? "ready-state ready" : "ready-state"
                    }
                  >
                    {player.ready ? "Ready" : "Standing by"}
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
  onActionMode(mode: ActionMode): void;
  onSelectUnit(unitId: string): void;
  onEndTurn(): void;
  onLeave(): void;
}

function MatchSidebar(props: MatchSidebarProps) {
  if (props.snapshot.status === "finished") {
    const winner = props.snapshot.players.find(
      (player) => player.id === props.snapshot.winnerId,
    );
    return (
      <aside className="match-sidebar">
        <div className={`panel result-panel ${props.didWin ? "victory" : "defeat"}`}>
          <span className="eyebrow">Match complete</span>
          <div className="result-icon">{props.didWin ? "V" : "×"}</div>
          <h2>{props.didWin ? "Victory" : "Defeat"}</h2>
          <p>{winner?.displayName ?? "The opposing squad"} secured the Warehouse.</p>
          <button className="secondary-button full-width" onClick={props.onLeave}>
            Return to lobby
          </button>
        </div>
        <SquadPanel {...props} />
      </aside>
    );
  }

  return (
    <aside className="match-sidebar">
      <div className="panel turn-panel">
        <div className="turn-heading-row">
          <span className="eyebrow">Round {props.snapshot.currentRound}</span>
          <span className={props.isMyTurn ? "turn-live" : "turn-wait"}>
            {props.isMyTurn ? "Your turn" : "Opponent"}
          </span>
        </div>
        <div className="ap-display">
          <strong>{props.snapshot.actionPointsRemaining}</strong>
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
                {props.selectedUnit.name.slice(0, 1)}
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
      </div>
      <SquadPanel {...props} />
    </aside>
  );
}

function SquadPanel(props: MatchSidebarProps) {
  const ownUnits = props.snapshot.units.filter(
    (unit) => unit.ownerId === props.localPlayerId && !unit.isDecoy,
  );
  return (
    <div className="panel roster-panel">
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
          <i className={`class-dot ${unit.classId}`} />
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

function isCombatClass(classId: string): classId is UnitClassId {
  return (
    classId === "breacher" || classId === "sniper" || classId === "trickster"
  );
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
