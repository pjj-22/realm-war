# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

HexNation (repo/package name: `realmwar` - only the player-facing brand was renamed at launch) is a persistent real-time multiplayer strategy game on a real-world map, **live at https://hexnation.app**. An H3 hex grid (resolution 7) overlays a MapLibre GL map on OpenFreeMap tiles; players claim hexes, build, train troops, and fight. The game runs continuously server-side via timers - there is no "game session".

Two independent npm packages: `server/` (Node/Express 5 + Socket.io + PostgreSQL, ES modules, no ORM) and `client/` (React 19 + Vite + MapLibre GL 6). Game design doc: `docs/design.md`. Use "HexNation" in any user-facing copy; internal identifiers stay `realmwar`.

**Deploying**: `server/DEPLOY.md` is the real guide - Docker Compose (`docker-compose.yml`, `deploy.sh`) on the shared CalendarChef droplet behind a Cloudflare Tunnel, images built by `.github/workflows/deploy.yml` and pulled manually with `./deploy.sh`. Nothing auto-deploys to the box. `scripts/backup-db.sh` is the nightly `pg_dump`. `PRODTODO.md` tracks what's still open post-launch. Under `MODE=prod` the server refuses to boot with placeholder `JWT_SECRET`/`ADMIN_SECRET` or a missing `CLIENT_ORIGIN`; CORS locks to `CLIENT_ORIGIN`, admin routes are rate-limited behind a timing-safe secret compare, and the rate limiter keys off `req.ip` (`TRUST_PROXY=1` behind the tunnel).

## Commands

```bash
# Database (first time)
createdb realmwar
psql -d realmwar -f server/schema.sql

# Server - port 3001
cd server && npm install
cp .env.example .env        # DATABASE_URL, JWT_SECRET, ADMIN_SECRET, VAPID_* (web push, optional)
npm run dev                 # nodemon
npm test                    # node --test, in-memory Postgres (pg-mem) - no DB needed

# Client - port 5173
cd client && npm install
cp .env.example .env        # VITE_API_URL, VITE_SOCKET_URL
npm run dev
npm run lint                # eslint (informational in CI)
```

**E2E tests** (Playwright, client only): need the server on 3001 with a **real** database, plus the client on port **5199** (`playwright.config.js` baseURL):

```bash
cd client
npm run dev -- --port 5199   # in one terminal
npm run test:e2e             # all specs - desktop (1440x900) + tests/e2e/mobile.spec.js (Pixel 7 device emulation)
npx playwright test tests/e2e/mobile.spec.js
```

Tests create throwaway accounts (`test_<timestamp>`) against the API and never delete them. Use Chromium-based device descriptors (`devices['Pixel 7']`), not iPhone/WebKit ones - CI installs only Chromium and WebKit needs extra system libs. CI retries e2e once (toast-timing flakes under runner load); locally `retries: 0`. Note `server/.env` in this checkout may carry `MODE=prod` + an old `CLIENT_ORIGIN`; for local e2e start the server as `MODE=dev CLIENT_ORIGIN='' node index.js`.

## MODE

`server/config.js` derives pacing from `MODE`: `dev` (default when unset/unrecognized - fast clock, inflated sandbox economy), `test` (fast clock, real economy), `prod` (real pacing + the boot guards above). `IS_DEV` controls pacing, `IS_SANDBOX` controls economy - keep that distinction. Every game constant (tick interval, costs, training/march times, gold caps, decay thresholds) branches on these; all balance tuning lives in `config.js` and `strategic.js` - don't hardcode game numbers elsewhere. `/api/health` reports `mode` and the live constants.

## Architecture

### Server: REST for actions, timers for simulation, sockets for invalidation

- **`index.js`** mounts routes under `/api/*`, runs `runMigrations()` (ad-hoc DDL on every boot; it detects whether `players.id` is UUID (older DBs) or SERIAL and builds FKs to match), then `initPush()` and `startTick()`. `runMigrations()` has no caller-side try/catch - a throwing statement aborts boot before `startTick()`, so wrap anything that can fail on existing data (see the `players_username_lower_idx` example).
- **`tick.js`** is the game engine: `runTick` (economy, strategic/zone bonuses, crowns, gold caps, hex history) on `TICK_INTERVAL_MS`, `processDecay`, and 15s loops for `processTraining`, `processCombat` (arrivals → reinforce/claim/start battle), `processBattleRounds` (dice clashes - see `combat.js`), `processUpgrades`, `processSeason`. All time-driven mutation lives here, not in routes.
- **Visibility (`visibility.js`)** - fog of war is enforced **server-side**. `buildVisibleSet(playerId)` = own + allied hexes expanded by a ring (port of the client's `buildVisibleSet`); `isDark(h3)` = outside local 6am-8pm by longitude; `canSeeDetail(h3, set, projected, now, isOwner)` is the one check every data route uses before sending real `troop_count`, buildings, army `quantity`, or battle strength. Guests (`optionalAuth`, no `req.player`) get an empty visible set, not a skipped check. Owners/participants always see their own numbers. There is deliberately no unredacted public hex dump - the admin portal uses `/api/admin/hexes/all` behind `requireAdmin`. When adding a route that returns per-hex/army/battle data, run it through `canSeeDetail`.
- **Auth**: `requireAuth` (401 without a valid JWT) for mutations; `optionalAuth` (sets `req.player` if a valid token is present, never rejects) for read routes that "Browse as guest" must reach: `/hexes/viewport`, `/battles/*`, `/military/armies`, `/buildings/:h3Index`. Admin routes use `x-admin-secret` against `ADMIN_SECRET`. Usernames are stored as typed but unique case-insensitively (`players_username_lower_idx`); `/login` matches case-insensitively.
- **NPC players**: bots (`bots.js`, `BOT_` prefix) act each tick and insert armies directly (they bypass `/march` - apply any march-side rule there too); the Wildlands player (`wild.js`, `WILD_Marauders`) owns neutral camps and never acts. Code distinguishes NPCs only by username prefix.
- **Notifications**: `push.js` (web-push; silently disabled without VAPID env) + `notify.js` (`notifyIncomingAttack`, called from `/march` and bot marches). Incoming-attack events are always about the recipient's own hex, so they're never redacted.
- **Alliances**: `players.alliance_id`; combat treats same-alliance as friendly (`sameAlliance()` in tick.js); allies share fog-of-war vision.
- **Seasons** (`season.js`): timed ages; `processSeason` snapshots standings, crowns the champion, wipes the map, respawns bots, emits `season:update`.
- **World feed**: `world_events` (`insertWorldEvent`) → `/api/world/events` → "The Herald" tab. `country_crowns` tracks rulers.
- **Socket.io is a notification bus only.** Bare event names, no payload; clients refetch via REST. Prefer `emitToRegion(h3, event)` (rooms at `REGION_RESOLUTION`) over global emits. Clients send `watch-regions` (capital regions always; viewport regions only while `showsIndividualHexes()` is true - at low zoom the viewport spans thousands of regions and blew request-size limits) and the server caps it at 3000. **When a mutation changes shared state, emit the matching event or other clients won't see it** (the flag-save route once didn't - stale flags until refresh).
- **Database**: raw `pg` pool (`db.js`), `withTransaction` for the few multi-statement paths, queues are tables polled by tick loops. `schema.sql` is the base for a fresh install; `runMigrations()` is authoritative for anything added since - keep both in sync (`battle_rounds` and the username index were migration-only until 2026-09-17).
- **Geo is in-process**: `terrain.js` (ocean check via land-10m topojson + `LAND_OVERRIDES`), `countries.js` (hex → country), `strategic.js` (named cities/chokepoints, `CAPITAL_COUNTRY`), `marchPath.js` (weighted A* with 10× ocean cost).

### Client: GameMap is the hub

- **`App.jsx`** handles auth/FTUE/modals, then renders `GameMap`; `#admin` swaps in `AdminPortal` (lazy-loaded - keep it out of the main bundle).
- **`components/GameMap.jsx`** (~2,700 lines) owns the MapLibre map, all game-state fetching, hex rendering, selection, and the topbar; panels (`BottomDrawer`, `ArmiesHUD`, `BattlePanel`, `LeaderboardPanel`, `EventFeed`) are its children. `showsIndividualHexes()` decides the view mode by the *estimated cell count in the bounds* (≤ 4000, the `POST /hexes/viewport` cap), not a fixed zoom - a fixed zoom-8 cutoff sent 36k-cell/225KB bodies at 1440×900 and got 413s. Detail mode renders res-7 viewport hexes (`hexes` source); otherwise (down to zoom 3) the coarser `overview-hexes` layer colored by dominant owner - **a layer added to one source is not on the other** (the night tint, for example, is only on `hexes`). Client-side `fog` (own+ally ring) is now cosmetic on top of server redaction; a server-nulled `troop_count` renders as `-1`/"?" - keep `null` distinct from `0` (`hexToGeoJSONFeature` is called for *unclaimed* cells too, where `claimed` is `undefined`). Interval-driven map updates (army positions, pulses) must skip while `map.isMoving()` - concurrent `setData`/`setPaintProperty` during a zoom gesture races MapLibre's render loop. Always go through `cellsInViewport()` for bounds → h3 cells, never `polygonToCells(map.getBounds()...)` directly: bounds on a wide window at low zoom span ≥180° of longitude (with unwrapped values like -187°), which h3 reads as a transmeridian ring and either fills the complement or throws `E_FAILED`.
- **MapLibre 6**: ESM-only (`import * as maplibregl`), WebGL2 required, `icon-offset` no longer scales with `icon-size` (offsets in code are pre-scaled), `GeoJSONSource.setData` returns nothing. Its worker is wired via `import url from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'` + `setWorkerUrl(url)` - `?worker&url` so Vite bundles the worker *with* its `./maplibre-gl-shared.mjs` import (a plain `?url` copies the file alone and that import 404s at runtime; no `setWorkerUrl` at all and the build never emits it). The "map renders" check is the tile-count assertion in `ui.spec.js`/`mobile.spec.js`: a dead worker throws no page error, it just never requests a `.pbf`.
- **`daylight.js`** mirrors the server's day/night rule for *display only* (night tint, topbar sun/moon, "Daylight here" in the drawer) - never for gating data.
- **Onboarding (`FTUEGuide.jsx`)** is an event-driven checklist, not copy: action steps advance only on the real deed - `player.capital_hex`/`player.flag_pixels` changing, or `ftueProgress('train'|'march'|'build')` (`ftueBus.js`) fired from the success paths in `BottomDrawer`/`GameMap`. If you add a new way to train/march/build, fire the matching event there too. The banner editor (`FlagOnboardingModal`) is held back while the guide is running and opens from its "Raise your banner" step (`bannerRequested` in `App.jsx`); with the guide skipped/finished it still opens on its own once a capital exists. Keep step copy to one verb + one short why - mechanics belong in the UI they describe, and the long-form reference is `HelpModal` (whose top section mirrors the steps).
- **`api/client.js`** is the single REST wrapper; token from `localStorage.rw_token`, attached when present. Add endpoints there.
- **`hooks/useSocket.js`** keeps one shared socket; components pass `{ eventName: handler }` maps and refetch on events.
- **Mobile**: `useIsMobile()` (768px) drives layout in JS; `100dvh`, `env(safe-area-inset-*)`, a horizontally scrolling topbar, `overscroll-behavior: none`, and a phone-only 16px input rule (iOS auto-zoom) live in `index.css`. Icons are hand-drawn SVGs in `Icons.jsx` - CI rejects pictographic emoji in source.
