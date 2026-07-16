# Tactics Lite

The playable core of a compact, server-authoritative browser tactics game. Two players join a private room and command three synchronized units each through deterministic, AP-driven combat.

## Phases 1–2 include

- room creation with a shareable six-character code and URL
- exactly two players with display names and a ready check
- synchronized 8 x 8 warehouse test grid
- a Breacher, Sniper, and Trickster for each player
- a shared six-action-point pool with path-based movement costs
- server-authoritative pathfinding, collisions, attacks, sight lines, and low cover
- HP, elimination, victory detection, turn switching, and round counting
- React lobby/UI, Phaser board renderer, Colyseus server
- deterministic rule tests and a GitHub Actions build

## Run locally

Requirements: Node.js 24+ and npm 11+.

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in two browser windows. Create a room in the first window, join with its code in the second, and set both players ready.

The client uses `http://localhost:2567` by default. Copy `.env.example` to `.env` and set `VITE_SERVER_URL` for another server URL.

## Commands

```bash
npm run dev        # client and server
npm run test       # 30 deterministic core and server utility tests
npm run typecheck  # all workspaces
npm run build      # production builds
npm run smoke:multiplayer # plays a complete two-client elimination match
```

## Repository layout

- `apps/client` — React shell and Phaser renderer
- `apps/server` — Colyseus room, authoritative state, and message validation
- `packages/game-core` — renderer- and network-independent rules/configuration
- `docs/architecture.md` — architecture analysis, data model, risks, and implementation plan

No database or account system is required for this proof of concept. Rooms live in server memory and disappear when empty.

## Known Phase 2 limitations

- Room state is in memory; restarting the server removes active rooms.
- A disconnect returns a running match to the waiting state. Token-based reconnect is reserved for the later polish phase.
- The three classes have distinct base stats, but their active and passive abilities begin in Phase 3.
- Team selection, rematch, reconnect tokens, sound, and final action animations remain later-phase work.
- Phaser is lazy-loaded only when a match starts, but its isolated production chunk is still about 1.2 MB before gzip.
