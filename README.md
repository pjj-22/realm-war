# HexNation

**Live at [hexnation.app](https://hexnation.app).** *(Repo and package names are still `realmwar` - the game was renamed at launch; only the player-facing brand changed.)*

A persistent, real-time multiplayer strategy game played on a real-world map. Every hex is a real place. You found a capital, claim territory hex by hex, build an economy, raise armies, and fight other players - and a roster of bot empires - for control of real countries.

The world runs continuously on the server. Log off and your territory, armies, and battles keep going.

## Features

- **Real-world map** - MapLibre GL over OpenFreeMap tiles, with an H3 hex grid (resolution 7, ~5 km² hexes) overlaid on actual geography
- **Territory** - your first claim becomes your capital; after that you march troops to a hex to take it
- **Economy** - gold every tick (10 min in prod) from hexes and mines; gold cap scales with territory
- **Buildings** - one per hex: Mine (+3g/tick), Barracks (10× faster training), Fort (3 defenders roll with advantage)
- **Marching** - armies travel the actual hex-by-hex path in real time; ocean crossings cost 10×
- **Dice combat** - battles resolve in discrete clashes: a capped frontline from each side rolls, refilled from reserve. Forts, entrenchment (+1 advantaged defender per adjacent friendly hex, max +4) and strategic hexes let defenders roll two dice and keep the higher
- **Fog of war - enforced server-side** - troop counts, buildings, army sizes and battle strength are redacted in the API for anything outside your visible ring (own + allied hexes + 1). Huge garrisons/empires "project power" and stay visible
- **Night** - a hex outside its local daylight hours (6am-8pm, by longitude) is hidden from everyone except its owner; the topbar sun/moon shows day/night at your viewport center
- **Strategic cities & crowns** - real capitals pay bonus gold; own a country's capital plus enough of its land to be crowned its Ruler, announced in **The Herald** (global feed)
- **Wonders & monuments** - real landmarks as capturable objectives with keeper income
- **Alliances** - invite code, shared vision, can't attack each other, reinforce each other's battles, private chat (chat off by default until there's moderation)
- **Border decay** - big empires slowly lose unguarded, undeveloped border hexes
- **Marauder camps** - neutral garrisons seeded near new capitals; raid them for gold
- **Seasons** - timed ages (90 days prod); most hexes at the horn is crowned Champion, the map resets, accounts and history persist
- **Push notifications** - web push for incoming attacks / capital falls, opt-in
- **Guest browsing** - the world map is viewable without an account (fogged)
- **Mobile** - bottom-drawer UI, touch, safe-area aware; e2e tested on a phone viewport

## Stack

| Layer | Tech |
|---|---|
| Client | React 19, Vite, MapLibre GL 6, h3-js, Socket.io client |
| Server | Node 20, Express 5, Socket.io 4, `pg` (no ORM) |
| Database | PostgreSQL 15 |
| Auth | JWT (7-day), bcrypt |
| Deploy | Docker Compose + GHCR images + Cloudflare Tunnel - see `server/DEPLOY.md` |

## Local development

```bash
# Database (any Postgres 14+; a docker container works fine)
createdb realmwar
psql -d realmwar -f server/schema.sql

# Server - port 3001
cd server && npm install
cp .env.example .env        # DATABASE_URL, JWT_SECRET, ADMIN_SECRET; leave MODE unset for dev pacing
npm run dev

# Client - port 5173
cd client && npm install
cp .env.example .env        # VITE_API_URL / VITE_SOCKET_URL -> http://localhost:3001
npm run dev
```

`MODE` (in `server/config.js`) is the single pacing switch: `dev` (default - fast clock, generous sandbox economy), `test` (fast clock, real economy), `prod` (real pacing; boot refuses placeholder secrets / missing `CLIENT_ORIGIN`).

| | dev | prod |
|---|---|---|
| Resource tick | 30s | 10 min |
| Training | ~0.1 min/troop | 3 min/troop |
| March | 0.25 min/hex | 25 min/hex |
| Starting gold | 9999 | 100 |
| Season | 5 min | 90 days |

## Tests

```bash
cd server && npm test                    # unit tests (node --test, in-memory Postgres via pg-mem)

cd client
npm run dev -- --port 5199               # e2e needs the server on 3001 + a real DB, client on 5199
npm run test:e2e                         # desktop + mobile (Pixel 7 emulation) specs
```

CI runs all of it on every push to `main`, then builds and pushes images to GHCR.

## Sounds

Synthesized with WebAudio by default. Drop mp3s into `client/public/sounds/` (`horn`, `battle`, `capture`, `coin`, `fanfare`) to override; the mute toggle is in the dispatches panel.
