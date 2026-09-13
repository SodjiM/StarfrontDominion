# Starfront: Dominion

A turn-based multiplayer space strategy game featuring persistent galaxies, tactical movement, abilities, harvesting, and combat — playable with friends and factions.

## Quick Start

1) Install dependencies
```bash
npm install
```

2) Start the server (builds the React landing automatically on first install)
```bash
npm start
```

3) Open the game
- React landing: `http://localhost:3000/`
- Legacy client UI: `http://localhost:3000/play`

The server serves both the built React SPA and the legacy client.

## Requirements

- Node.js 18+ (recommended)
- npm 9+
- No external database required (SQLite file is created automatically)

## Repository Layout

- `server/`: Express + Socket.IO API server, SQLite DB, turn scheduler
  - `routes/`: REST endpoints (`auth`, `lobby`, `game/*` modules)
  - `services/`: game logic (abilities, movement, combat, harvesting, build, world gen)
  - `sockets/`: realtime game channel
  - `scheduler/`: auto turn resolution for games with `auto_turn_minutes`
  - `models/`: SQL schema files
  - `config/`: env-driven server configuration
- `client/`: legacy browser client (vanilla JS/HTML/CSS) served at `/play`
- `web/`: React landing (Vite) served at `/` (built to `web/dist`)
- `tools/`: asset pipeline utilities (sprite packing, frames)
- `art_src/` and `client/assets/`: source art and packed assets

## Scripts

All scripts are in `package.json`.

- `start`: run the API server (`server/index.js`)
- `dev`: alias of `start`
- `build`: builds the React landing (same as `web:build`)
- `web:dev`: Vite dev server for the React landing (HMR)
- `web:build`: production build for the React landing (output to `web/dist`)
- `web:preview`: preview the built React site
- Asset pipeline:
  - `art:prep`, `art:frames`, `art:pack`
  - Explorer-specific helpers: `art:prep:explorer`, `art:frames:explorer`, `art:pack:explorer`, `art:explorer`
  - `art:watch`: watch `art_src/**/*` and rebuild select assets

Notes:
- `postinstall` automatically runs `web:build` so `npm start` can immediately serve the SPA at `/`.

## Environment Variables

Defined in `server/config/index.js`:

- `PORT` (default: `3000`)
- `NODE_ENV` (default: `development`)
- `ADMIN_SECRET` (optional; reserved for future admin endpoints)
- `ENABLE_CORS` (`true`/`false`, default: `true`)

## Database

- SQLite database at `./database.sqlite` is created and migrated automatically on boot.
- Schemas are in `server/models/*.sql`; additional migrations are applied in `server/db.js`.
- Sample games are inserted on first run.
- Resetting the DB: stop the server and delete `database.sqlite` (this removes all data).

## Playing locally on your computer

No Linux server is needed. From the project folder, run `npm start`, then open
[http://localhost:3000/play](http://localhost:3000/play). Leave that terminal running.
This one Node process serves the game, login, multiplayer connections, and local SQLite database.
To view the landing page too, run `npm run build` once and open http://localhost:3000/.

`npm run web:dev` is optional: it provides live updates while editing the React landing page
on port 5173. It does not run the game server. Keep `npm start` running as well; Play/Join
on port 5173 redirects to the game on port 3000. Restart Vite after changing its configuration.
If the game uses a custom port, start Vite with `GAME_SERVER_PORT=3100 npm run web:dev`
(or your chosen port), matching the game's `PORT` value.

## Running in Development

Option A: single process (recommended to start)
```bash
npm start
```
Visit `http://localhost:3000/` (React landing) or `http://localhost:3000/play` (legacy client).

Option B: separate Vite dev server for the landing
```bash
# Terminal 1: API server
npm start

# Terminal 2: React landing with HMR
npm run web:dev
```

## Gameplay Features (implemented)

- Turn-based multiplayer with atomic turn resolution
- Massive sectors (5000x5000 grid)
- Fleet movement and warp (pathing, collision-aware movement, warp preparation/execution)
- Abilities with energy costs, ranges, cooldowns, and status effects
- Trails (sector movement history) and combat logs endpoints for UI
- Fog-of-war and visibility updates per turn
- Harvesting and cargo systems (loot, wrecks, jettison, salvage)
- Player setup and lobby flows
- Auto turn scheduler (`auto_turn_minutes`) for persistent games

## HTTP API Overview

Base server: `http://localhost:3000`

Public/utility endpoints:
- `GET /health` – server health
- `GET /play` – serves legacy client
- `GET /game/sector/:sectorId/trails?sinceTurn=&maxAge=` – movement history
- `GET /game/ability-cooldowns/:shipId` – current cooldowns for a ship
- `GET /combat/logs/:gameId/:turnNumber` – combat logs for a turn

Modular routes (mounted under `/auth`, `/lobby`, and `/game`):
- `/auth` – authentication
- `/lobby` – lobby and game discovery/joins
- `/game/state` – game state snapshots
- `/game/build` – construction endpoints
- `/game/cargo` – cargo operations
- `/game/galaxy` – galaxy/system data
- `/game/movement` – movement orders
- `/game/players` – player management
- `/game` – additional game flow routes

Realtime:
- Socket.IO channel registered in `server/sockets/game.channel.js`
- Clients receive turn resolution events and state updates

## Frontends

- React landing (SPA): `web/` (Vite). Built assets are served from `/`.
- Legacy client: `client/` (vanilla JS/HTML/CSS). Served at `/play`.

## Asset Pipeline

Source art in `art_src/` is processed into sprite sheets used by the client.

Common tasks:
```bash
# Process explorer ship assets end-to-end
npm run art:explorer

# Watch for changes and rebuild explorer assets
npm run art:watch
```

## Contributing

Issues and PRs are welcome. Before contributing, please run the server locally and familiarize yourself with the client UI at `/play`.

## License

ISC
## Navigation and authentication update

- Movement commands submit a destination. The server computes a bounded obstacle-aware route from the current ship position and retries blocked routes on subsequent turns. Route previews and ETAs are returned in the acknowledgement.
- Use the strategic map for warp lanes. The server issues a short-lived route identifier and executes approach, tap queue/wildcat merge, transit, inter-lane approach, and final arrival. Reverse lanes and zero endpoints are supported. A ship completes at most one lane leg per turn; unused warp distance does not carry into the next leg. Cancel an itinerary before issuing ordinary movement. The retired instant-warp command is unavailable.
- Login/registration establish a seven-day HttpOnly, SameSite=Strict session cookie. HTTP and Socket.IO verify it; submitted user IDs cannot change identity. Logout revokes the session and disconnects its sockets. Existing localStorage identity alone is insufficient: sign in again.
- Production cookies require HTTPS (`NODE_ENV=production`). Keep the browser and API on the same origin. Administrative clear-all is disabled, and resource respawn requires a configured admin secret.
- `DATABASE_PATH` selects the SQLite file (default `./database.sqlite`). No old-world conversion is provided for the new travel lifecycle.

### Deterministic local QA world

Create a disposable, repeatable two-player scenario for movement and lane testing with:

```bash
npm run test:world
```

The command uses `.data/family-test.sqlite` by default and prints the game/sector IDs and test logins (`family-alice` and `family-bob`, password `family-test`). It replaces only the specifically named `Family QA World`; it does not modify the normal `database.sqlite`. To place the scenario elsewhere, set `DATABASE_PATH` explicitly, for example `DATABASE_PATH=/tmp/starfront-family.sqlite npm run test:world`.

Run `npm run test:playability` for the automated movement, lane, authentication, and turn gate. The browser reconnect/restart checklist is in [docs/reviews/2026-09-12-playability-checklist.md](docs/reviews/2026-09-12-playability-checklist.md).
- Run `npm test` for real SQLite navigation/turn tests and localhost HTTP/Socket.IO authentication tests. Run `npm run build` for the landing build. Tests create only in-memory databases; the initial audit harness now delegates to correctness tests.

Lane ETAs remain estimates: obstacles, congestion, queueing, and per-leg transitions can add turns. A full family playtest and the separate economy/combat findings from the review remain follow-up work.
