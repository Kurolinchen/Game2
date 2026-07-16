# Tactics Lite: architecture and playable-core plan

## 1. Architecture analysis

The proposed TypeScript + Phaser + Colyseus stack is a good fit for a small deterministic tactics game. Phaser handles a responsive, input-friendly board without coupling rendering to rules. React owns forms, room state, HUD, and accessibility-oriented DOM UI. Colyseus provides room lifecycle, matchmaking, binary schema synchronization, and an authoritative mutation boundary.

The important constraint is that the browser sends intentions, never results. A client may request `move(unitId, x, y)`, but only the server checks turn ownership, distance, bounds, obstacles, and occupancy before changing synchronized state. The client renders the state it receives.

The pure `game-core` package keeps deterministic calculations free of Colyseus, Phaser, and React. Later abilities, line-of-sight, AP, damage, and victory logic can grow here and remain cheap to test.

## 2. Concrete file tree

```text
.
├── .github/workflows/ci.yml
├── apps
│   ├── client
│   │   ├── src
│   │   │   ├── game/           Phaser scene and bridge
│   │   │   ├── multiplayer/    Colyseus adapter and snapshots
│   │   │   ├── App.tsx
│   │   │   └── styles.css
│   │   └── vite.config.ts
│   └── server
│       └── src
│           ├── rooms/schema/    synchronized Colyseus schemas
│           ├── rooms/TacticsRoom.ts
│           ├── app.config.ts
│           └── index.ts
├── packages
│   └── game-core
│       └── src
│           ├── config.ts
│           ├── movement.ts
│           ├── turn.ts
│           └── types.ts
├── docs/architecture.md
└── package.json
```

## 3. Synchronized data model

`MatchState` is the synchronized room root:

| Field | Purpose |
| --- | --- |
| `roomCode` | shareable room identifier |
| `status` | `waiting`, `playing`, or `finished` |
| `currentRound` | one-based round counter |
| `activePlayerId` | only player allowed to act |
| `actionPointsRemaining` | shared six-point turn budget |
| `boardWidth`, `boardHeight` | renderer-independent board dimensions |
| `players` | map of session ID to player state |
| `units` | map of unit ID to unit state |
| `tiles` | synchronized floor, low-cover, and high-obstacle tiles |
| `winnerId` | authoritative elimination winner |

`PlayerState` stores `id`, `displayName`, `slot`, `ready`, and `connected`. `UnitState` stores identity, class, owner, position, HP, movement range, attack range, damage, and alive state. `TileState` stores position, floor/cover/obstacle type, walkability, sight blocking, and deterministic cover value.

## 4. Server/client split

| Server owns | Client owns |
| --- | --- |
| room creation and two-seat limit | display-name and room-code forms |
| ready state and match start | copying room link/code |
| unit spawning | board and HUD rendering |
| pathfinding and AP validation | selection and move previews |
| collision and occupancy | input intent messages |
| sight lines, cover, damage, death | attack-target and damage feedback |
| active player and round changes | error presentation and connection status |
| synchronized canonical state | no canonical game-rule decisions |

## 5. Technical risks

| Risk | Phase 1 mitigation |
| --- | --- |
| Client/server version drift | pin compatible Colyseus 0.17 packages and schema 4.x |
| Rule logic leaking into rendering | pure `game-core` dependency with no UI/network imports; the client reuses it only for previews |
| Invalid or malicious messages | validate payload shape, ownership, turn, distance, bounds, and collisions server-side |
| Room-code collisions | reserve generated codes through Colyseus Presence before exposing a room |
| Stale UI from incremental state | convert each synchronized update into an immutable client snapshot |
| Phaser lifecycle leaks in React | one game instance per mounted board, explicit shutdown on unmount |
| Disconnects breaking a match | expose connection state now; full token-based recovery remains a later phase |
| Deployment topology | client server URL is environment-driven; health endpoint supports hosting checks |

## 6. Phase 1 implementation plan

1. Create the monorepo, shared configuration, and deterministic movement/turn rules.
2. Define Colyseus schemas and a private two-player room with a unique room code.
3. Add ready handling, deterministic spawns, validated movement, end-turn handling, and round changes.
4. Build the React lobby and connect it through the official Colyseus browser SDK.
5. Render the synchronized grid in Phaser and turn pointer input into move requests.
6. Add tests for legal/illegal movement, collisions, and round progression.
7. Run tests, type checking, and production builds before publishing the phase.

## Deliberately deferred

Accounts, persistence, special abilities, reconnect tokens, rematches, matchmaking, ranking, AI, additional maps, and mobile polish remain outside Phase 2. The boundaries above leave explicit extension points for them.

## 7. Phase 2 implementation

Phase 2 turns the network proof of concept into a complete elimination match:

1. Each player receives one Breacher, Sniper, and Trickster with centrally configured HP, movement, range, and damage.
2. Each turn starts with six shared AP. Movement costs one AP per traversed tile; a standard attack costs two AP.
3. The server finds and validates shortest orthogonal paths around cover, high obstacles, and living units.
4. Standard attacks validate ownership, AP, range, deterministic sight lines, and facing cover before applying damage.
5. Zero HP marks a unit eliminated and frees its tile. Eliminating all three enemy units finishes the match and records the winner.
6. The Phaser board previews reachable tiles and attackable targets while React presents AP, unit stats, squad status, and the final result.
7. The multiplayer smoke script creates two real clients and completes a five-round elimination match against a passive opponent.
