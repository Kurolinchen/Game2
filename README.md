# Tactics Lite

The playable core of a compact, server-authoritative browser tactics game. Two players join a private room and command three synchronized units each through deterministic, AP-driven combat.

## Phases 1–7 include

- solo matches against Easy, Normal, or Hard CPU opponents
- hover movement paths, AP costs, attack lines, damage, and cover previews
- animated movement, shots, push, swap, cover destruction, and eliminations
- distinct class silhouettes, turn banners, CPU status, and a recent-action log
- dedicated Solo Operation and Private Duel lobby cards
- automatic and reload-safe reconnects with a 60-second reserved seat
- cold-start recovery, UI error containment, and public-server rate limits
- two-tap touch confirmation, browser E2E coverage, and CPU balance simulations
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
- three selectable battlefields: Warehouse, Crossfire, and Foundry
- rematches, surrender, synchronized result statistics, and restored map state
- procedural game sounds with volume and mute controls
- a four-step first-match tutorial, high-contrast mode, and reduced motion
- full two-browser Private Duel coverage and CI multiplayer smoke testing
- dependency monitoring, production origin controls, security headers, and structured room logs

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
5. In Render, set `ALLOWED_ORIGINS` to the Vercel origins that may connect, separated by commas. A narrowly scoped `*` is supported for project preview URLs, for example `https://game2-client.vercel.app,https://game2-client-*.vercel.app`. Leave it empty only during initial setup.
6. Redeploy the latest `main` deployment in Vercel.

Render Free services spin down while idle, so the first request after a quiet period can take longer. Opening `/health` wakes the server before a play session.

## Commands

```bash
npm run dev        # client and server
npm run test       # deterministic client, core, server, map, and CPU tests
npm run typecheck  # all workspaces
npm run build      # production builds
npm run test:e2e   # real Chromium flow, canvas check, touch, and reload reconnect
npm run balance:cpu # runs nine seeded CPU balance matches
npm run smoke:multiplayer # reconnects, exercises all abilities, and completes a match
```

## Repository layout

- `apps/client` — React shell and Phaser renderer
- `apps/server` — Colyseus room, authoritative state, and message validation
- `packages/game-core` — renderer- and network-independent rules/configuration
- `docs/architecture.md` — architecture analysis, data model, risks, and implementation plan

No database or account system is required for this proof of concept. Rooms live in server memory and disappear when empty.

## Known limitations

- Room state is in memory; restarting the server removes active rooms.
- Reconnect survives short drops and reloads, but not a full server restart because room state remains in memory.
- Accounts, public matchmaking, rankings, and richer sprite artwork remain later-phase work.
- Phaser is lazy-loaded only when a match starts, but its isolated production chunk is still about 1.2 MB before gzip.
