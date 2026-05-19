# RealmWar

A persistent, real-time multiplayer strategy game played on a real-world map. Every hex on the grid is a real geographic location. You claim territory, build armies, and fight other players for control of the map.

There are about 1.5 million land hexes in the database. The game runs continuously — when you log off, your territory stays where you left it.

## Features

- **Real-world map** — Mapbox satellite/terrain map with an H3 hex grid overlay at ~10km resolution
- **Territory claiming** — adjacent-only expansion; march troops to a hex to take it
- **Economy** — gold ticks every 10 minutes based on hexes and mines owned; gold cap scales with territory size
- **Buildings** — Mine (+3g/tick), Barracks (halves training time), Fort (+40% defense)
- **March system** — armies travel hex-by-hex in real time; ocean hexes cost 10× march time
- **Combat** — deterministic rounds (15% damage per round), fort defense bonuses, battle feed with participants
- **Rally points** — set a rally hex per territory; newly trained troops auto-march there
- **Bots** — 6 persistent bot players (New York, London, Tokyo, São Paulo, Delhi, Cape Town) that expand, build, and attack
- **Leaderboard** — top 10 players by hex count and troops
- **Events feed** — battle results, hex losses, training completions
- **Country stats** — income breakdown by real country for owned territory
- **Fog of war** — enemy hex troop counts are hidden beyond your visible ring
- **Real-time updates** — Socket.io pushes hex ownership, army positions, and battle state live
- **Mobile-responsive** — playable on phone with bottom drawer UI

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + MapLibre GL |
| Real-time | Socket.io |
| Backend | Node.js + Express |
| Database | PostgreSQL |
| Hex grid | H3 (Uber) |
| Auth | JWT (7-day tokens, bcrypt) |

## Getting started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- A [Mapbox](https://mapbox.com) access token (free tier works)

### 1. Database

```bash
createdb realmwar
psql -d realmwar -f server/schema.sql
```

### 2. Server

```bash
cd server
npm install
cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET
npm run dev            # nodemon on port 3001
```

### 3. Client

```bash
cd client
npm install
cp .env.example .env   # fill in VITE_MAPBOX_TOKEN
npm run dev            # Vite on port 5173
```

## Configuration

`server/config.js` has a `DEV_MODE` flag at the top:

```js
export const DEV_MODE = true
```

| Setting | Dev | Prod |
|---|---|---|
| Resource tick | 30 seconds | 10 minutes |
| Training time | ~0.1 min/troop | 3 min/troop |
| March speed | 0.25 min/hex | 60 min/hex |
| Starting gold | 9999 | 100 |
| Gold cap | effectively unlimited | 500 + 100/hex |

Set `DEV_MODE = false` before deploying.

## Game mechanics

**Claiming hexes** — your first claimed hex becomes your capital. After that, you must march troops to a hex to claim it; you can't claim it from across the map.

**Economy** — every owned hex generates 1g per tick. Mines add 3g. Gold caps at `500 + 100 × hexes + 50 × mines`. Territory cost isn't punished by upkeep, but the cap means growth has diminishing marginal gold value.

**Combat** — when a marching army arrives at an enemy hex, a battle starts. Each round both sides lose 15% of the opponent's strength. Forts multiply defender strength by 1.4. The loser's troops are removed; if the attacker wins, they take the hex and all buildings are destroyed.

**Bots** — six bots start at real-world cities and play continuously: expand to nearby unclaimed hexes, build mines, train troops, attack neighbors. They respawn at their starting hex if eliminated.
