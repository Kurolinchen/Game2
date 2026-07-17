# Tactics Lite

The playable core of a compact, server-authoritative browser tactics game. Two players join a private room and command three synchronized units each through deterministic, AP-driven combat.

## Phases 1–4 include

- solo matches against Easy, Normal, or Hard CPU opponents
- room creation with a shareable six-character code and URL
- exactly two players with display names and a ready check
- synchronized 8 x 8 warehouse test grid
- a Breacher, Sniper, and Trickster for each player
- a shared six-action-point pool with path-based movement costs
- server-authoritative pathfinding, collisions, attacks, sight lines, and low cover
- HP, elimination, victory detection, turn switching, and round counting
- six class abilities: Kinetic Push, Breach, Long Shot, Overwatch, Swap, and Decoy
- synchronized per-unit cooldowns and distinct Breacher, Sniper, and Trickster passives
- ability target previews, cooldown feedback, reaction shots, and destructible low cover
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

## Deploy with Render Free and Vercel

The repository includes a `render.yaml` Blueprint for a free Render web service. No database is needed.

1. In Render, choose **New > Blueprint**, connect this GitHub repository, and deploy the detected `tactics-lite-server` service.
2. Wait for the service to report **Live**, then open its `/health` URL. It should return `{"status":"ok","service":"tactics-lite-server"}`.
3. Copy the Render service URL without a trailing slash, for example `https://tactics-lite-server.onrender.com`.
4. In the Vercel project, add `VITE_SERVER_URL` with that URL for **Production** and **Preview**.
5. Redeploy the latest `main` deployment in Vercel.

Render Free services spin down while idle, so the first request after a quiet period can take longer. Opening `/health` wakes the server before a play session.

## Commands

```bash
npm run dev        # client and server
npm run test       # 44 deterministic client, core, server, and CPU tests
npm run typecheck  # all workspaces
npm run build      # production builds
npm run smoke:multiplayer # exercises all abilities, then completes a two-client match
```

## Repository layout

- `apps/client` — React shell and Phaser renderer
- `apps/server` — Colyseus room, authoritative state, and message validation
- `packages/game-core` — renderer- and network-independent rules/configuration
- `docs/architecture.md` — architecture analysis, data model, risks, and implementation plan

No database or account system is required for this proof of concept. Rooms live in server memory and disappear when empty.

## Known limitations

- Room state is in memory; restarting the server removes active rooms.
- A disconnect returns a running match to the waiting state. Token-based reconnect is reserved for the later polish phase.
- Team selection, rematch, reconnect tokens, sound, and final action animations remain later-phase work.
- Phaser is lazy-loaded only when a match starts, but its isolated production chunk is still about 1.2 MB before gzip.
