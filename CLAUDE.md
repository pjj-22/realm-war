# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

RealmWar is a persistent real-time multiplayer strategy game on a real-world map. An H3 hex grid (resolution 7, ~10km hexes) overlays a MapLibre GL map; players claim hexes, build, train troops, and fight. The game runs continuously server-side via timers - there is no "game session".

Two independent npm packages: `server/` (Node/Express + Socket.io + PostgreSQL, ES modules, no ORM) and `client/` (React 19 + Vite + MapLibre GL). Game design doc: `docs/design.md`.

**Deploying**: `server/DEPLOY.md` is the droplet guide (systemd, nginx, TLS, env); `PRODTODO.md` tracks go-live status. Production boot (`NODE_ENV=production`) refuses to start unless `DEV_MODE=false`, real (non-placeholder) `JWT_SECRET`/`ADMIN_SECRET`, and `CLIENT_ORIGIN` are set — CORS locks to `CLIENT_ORIGIN`, admin routes are rate-limited with a timing-safe secret compare, and the rate limiter keys off `req.ip` (`TRUST_PROXY=1` behind a proxy).

## Commands

```bash
# Database (first time)
createdb realmwar
psql -d realmwar -f server/schema.sql

# Server - port 3001
cd server && npm install
cp .env.example .env        # DATABASE_URL, JWT_SECRET, ADMIN_SECRET, VAPID_* (web push, optional)
npm run dev                 # nodemon

# Client - port 5173
cd client && npm install
cp .env.example .env        # VITE_MAPBOX_TOKEN (map tiles), VITE_API_URL, VITE_SOCKET_URL
npm run dev
npm run lint                # eslint
```

**E2E tests** (Playwright, client only - the server has no tests): require a running server on 3001 with a real database, plus the client served at port **5199** (see `playwright.config.js` baseURL):

```bash
cd client
npm run dev -- --port 5199   # in one terminal
npm run test:e2e             # all specs
npx playwright test tests/e2e/auth.spec.js          # single file
npx playwright test --grep "login shows daily bonus" # single test
```

Tests create throwaway accounts (`test_<timestamp>`) directly against the API and never delete them.

## DEV_MODE

`server/config.js` derives `DEV_MODE` from the environment (`DEV_MODE=false` for prod speeds; defaults to true). Every game constant (tick interval, costs, training/march times, gold caps) branches on it - dev values are ~100× faster/cheaper. It is currently `true`; set to `false` for production speeds. All balance tuning lives in `config.js` and `strategic.js`; don't hardcode game numbers elsewhere.

## Architecture

### Server: REST for actions, timers for simulation, sockets for invalidation

- **`index.js`** mounts routes under `/api/*`, runs lightweight migrations (`runMigrations()` - ad-hoc DDL; it detects whether `players.id` is UUID (older DBs) or SERIAL (fresh `schema.sql` installs) and builds foreign keys to match), then calls `initPush()` and `startTick()`.
- **`tick.js`** is the game engine. `startTick()` registers `setInterval` loops: `runTick` (economy: per-hex gold, mine income, strategic bonuses, territory capital bonus, country-crown evaluation, gold cap enforcement, hex history snapshots) on `TICK_INTERVAL_MS`, plus `processDecay` (border decay for empires above `DECAY_HEX_THRESHOLD`), and 15-second loops for `processTraining`, `processCombat` (army arrivals → reinforce own/ally / claim / start battle, with entrenchment + fort + strategic defense multipliers), `processBattleRounds` (deterministic 15%-damage rounds; camp plunder payouts; capital-fall handling), and `processUpgrades`. All game-state mutation from time passing happens here, not in routes.
- **NPC players**: bots (`bots.js`, `BOT_` username prefix) play each tick; the Wildlands player (`wild.js`, `WILD_Marauders`) owns neutral camps seeded around new capitals and never acts. Code distinguishes NPCs only by username prefix - leaderboards/income exclude `WILD_`, events/pushes skip both.
- **Notifications**: `push.js` (web-push, VAPID keys from env, silently disabled if unset) + `notify.js` (`notifyIncomingAttack` - called from the march route and bot marches). Battle-start, capital-fall, and incoming-march warnings insert personal events and send pushes.
- **Alliances**: `players.alliance_id` is the membership model. Combat treats same-alliance as friendly (deposit instead of attack; third parties allied with the defender join the defender side) via `sameAlliance()` in tick.js. Client gets shared fog-of-war vision from `/api/alliance/mine` member ids.
- **Seasons** (`season.js`): timed ages (`SEASON_DURATION_MS`, 5 min in dev). `processSeason` on the 15s loop ends an expired season: snapshots top-10 standings to `seasons.snapshot`, crowns the champion, wipes hexes/troops/buildings/armies/battles/queues/crowns, resets player gold/capitals, respawns bots (`respawnBots` in bots.js), starts the next season, and emits `season:update`. Client shows a countdown chip, a season dashboard, and an end-of-season overlay (rollover detected via `localStorage.rw_season`).
- **World feed**: `world_events` table (`insertWorldEvent` in tick.js) records crowns, battles, capital falls; public via `/api/world/events`; rendered as "The Herald" tab in EventFeed. `country_crowns` tracks rulers (own a country's primary-capital hex + `CROWN_MIN_HEXES` hexes in that country).
- **Socket.io is a notification bus only.** `socket.js` exports `getIO()`; server code emits bare event names (`hexes:update`, `armies:update`, `battle:update`, `events:new`, `tick`) with no payload. Clients respond by refetching via REST. When a mutation changes shared state, emit the matching event or other clients won't see it.
- **Database**: raw `pg` pool queries (`db.js`), no transactions or ORM. Queues are tables polled by tick loops (`training_queue`, `upgrade_queue`, `armies` with `status='marching'` and `arrives_at`). Caution: `schema.sql` can lag behind code - e.g. `hex_history` is used by `tick.js`/`routes/players.js` but isn't in `schema.sql`; new columns get added via `runMigrations()` in `index.js`.
- **Geo data is computed in-process, not in the DB.** `terrain.js` (ocean check via point-in-polygon against world-atlas land topojson, cached per hex) and `countries.js` (hex → country/continent). `strategic.js` defines named strategic city/chokepoint hexes from lat/lng at module load; `CAPITAL_COUNTRY` drives the per-country territory income bonus.
- **Bots** (`bots.js`) are ordinary player rows with `BOT_` username prefix, processed at the end of each resource tick. Code distinguishes bots only by that prefix.
- **Auth**: JWT Bearer tokens (7-day), `requireAuth` middleware sets `req.player = { id, username }`. Admin routes (`routes/admin.js`) use an `x-admin-secret` header checked against `ADMIN_SECRET` instead.
- Ocean hexes are unclaimable but marchable at `OCEAN_MARCH_MULTIPLIER` (10×) cost.

### Client: GameMap is the hub

- **`App.jsx`** handles auth/FTUE/modal shell, then renders `GameMap`. URL hash `#admin` swaps the whole app for `AdminPortal`.
- **`components/GameMap.jsx`** (~1100 lines) owns the MapLibre map, all game state fetching, hex rendering, and selection; the panels (`BottomDrawer`, `ArmiesHUD`, `BattlePanel`, `LeaderboardPanel`, `EventFeed`) are its children. Rendering is zoom-dependent: zoom ≥ 8 renders res-7 viewport hexes; zoom 3–8 renders coarser parent-hex "overview" colored by dominant owner. Fog of war is computed client-side (`buildVisibleSet`: own hexes + 1-ring); fogged hexes get `troop_count: -1`.
- **`api/client.js`** is the single REST wrapper - every endpoint is a named method on the exported `api` object; token comes from `localStorage.rw_token`. Add new endpoints there, not as inline fetches.
- **`hooks/useSocket.js`** keeps one shared socket; components pass `{ eventName: handler }` maps and typically refetch on events.
