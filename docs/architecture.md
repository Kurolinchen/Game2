# Tactics Lite: architecture and Phase 1 plan

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

## 3. Phase 1 data model

`MatchState` is the synchronized room root:

| Field | Purpose |
| --- | --- |
| `roomCode` | shareable room identifier |
| `status` | `waiting` or `playing` |
| `currentRound` | one-based round counter |
| `activePlayerId` | only player allowed to act |
| `movesRemaining` | centrally configured Phase 1 action budget |
| `boardWidth`, `boardHeight` | renderer-independent board dimensions |
| `players` | map of session ID to player state |
| `units` | map of unit ID to unit state |
| `tiles` | synchronized floor and obstacle tiles |

`PlayerState` stores `id`, `displayName`, `slot`, `ready`, and `connected`. `UnitState` stores `id`, `ownerId`, `x`, and `y`. `TileState` stores `x`, `y`, `type`, `walkable`, and `blocksLineOfSight` so future line-of-sight work does not require a state migration.

## 4. Server/client split

| Server owns | Client owns |
| --- | --- |
| room creation and two-seat limit | display-name and room-code forms |
| ready state and match start | copying room link/code |
| unit spawning | board and HUD rendering |
| movement validation | selection and move previews |
| collision and occupancy | input intent messages |
| active player and round changes | error presentation and connection status |
| synchronized canonical state | no canonical game-rule decisions |

## 5. Technical risks

| Risk | Phase 1 mitigation |
| --- | --- |
| Client/server version drift | pin compatible Colyseus 0.17 packages and schema 4.x |
| Rule logic leaking into rendering | pure `game-core` dependency with no UI/network imports |
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

Accounts, persistence, three-unit teams, AP, combat, abilities, reconnect tokens, rematches, matchmaking, ranking, AI, additional maps, and mobile polish remain outside Phase 1. The boundaries above leave explicit extension points for them.

