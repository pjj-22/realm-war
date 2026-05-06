# Realm War — Plan

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Mapbox GL JS |
| Backend | Node.js + Express |
| Real-time | Socket.io |
| Database | PostgreSQL + PostGIS |
| Hex grid | H3 (Uber) |

---

## What's Built

### Core game loop (complete)
- Real-world Mapbox map with H3 hex grid overlay (viewport culling — only loads visible hexes)
- Ocean hexes blocked from capture and cost 10x march time
- JWT auth (register/login, 7-day token)
- Territory claiming (adjacent hexes only, or march troops there first)
- First claimed hex becomes capital
- Gold economy: 1g/hex + 3g/mine per tick (30s dev / 10min prod)
- Gold cap: 500 + 100/hex + 50/mine
- Buildings: Mine (+3g/harvest, 5g), Barracks (halves training, 10g), Fort (+40% defense, 10g) — one per hex
- Hex upgrades: in DB and queue, but upgrade_level has no gameplay effect yet
- Single troop type trained per hex; Barracks halves training time
- March system: troops move hex-by-hex in real time, ocean costs 10x
- Deterministic combat: 15% damage per round, forts add 40% defender multiplier, winner takes hex
- Capital capture resets capital_hex and fires alert
- 6 bots (BOT_Iron, BOT_Storm, etc.) that expand, build, train, and attack
- Events feed (battle results, hex losses, training complete)
- Leaderboard (top 10 by hex count + troops)
- Player stats broken down by country via countries.js + topojson
- HelpModal, mobile-responsive layout (useIsMobile hook)
- Full dev mode (fast ticks, cheap units, 9999 gold)

### Real-time (partial)
- Socket.io emits: `tick`, `hexes:update`, `armies:update`, `battle:update`
- Client hook registers listeners but map doesn't auto-refresh on socket events — mostly manual polling

---

## What's Left

### Must-have for v1 (playable multiplayer)

- [ ] **Fix real-time map refresh** — hex ownership and army positions should update live on socket events without manual polling
- [ ] **Alliances** — invite system, shared map color border, shared vision, resource sending, joint attacks, 24hr dissolution grace period
- [ ] **Hex upgrade effect** — upgrade_level is tracked but does nothing; give it a gameplay effect (e.g. +1g/tick, +10% defense)
- [ ] **Schema setup script** — no migrations file; new devs/deploys have no way to initialize the DB

### Nice-to-have for v1

- [ ] **Terrain flavor** — visual-only cosmetic (mountains, desert, coastline coloring based on lat/lng)
- [ ] **Home region bonus** — 25-hex radius around capital generates slightly more gold
- [ ] **Push notifications** — capital under attack (always on), border crossings (opt-in)
- [ ] **Rebellion mechanic** — hexes far from capital slowly decay to wildlands if unattended

### Post-v1

- [ ] Multiple troop types (Knights, Archers, Trebuchets) with a combat triangle
- [ ] Mana resource and global troop upgrades
- [ ] Alliance leaderboard (combined territory)
- [ ] Player progression (level, titles based on territory held over time)
- [ ] Season system (3-month cycles, partial reset, cosmetic rewards)
- [ ] Historical map (greatest extent timeline per player)
- [ ] Cosmetic shop (colors, banners, troop skins)
- [ ] Electron/Tauri desktop build
- [ ] Steam / App Store

---

## v1 Definition

Playable with real human players and bots. Win condition is owning the most territory. Core loop: expand, build economy, train troops, attack enemies, form alliances.

Blocking: real-time map refresh + alliances. Everything else can ship after.

---

## Dev Mode

`DEV_MODE = true` in `server/config.js`:
- Resource tick: 30s (prod: 10min)
- Training time: 0.1 min/troop (prod: 3min)
- March speed: 0.25 min/hex (prod: 60min)
- Starting gold: 9999 (prod: 100)
