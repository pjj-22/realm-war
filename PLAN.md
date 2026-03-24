# Realm War — Build Plan

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React (web) | Runs in browser locally, wrappable for all platforms |
| Map | Mapbox GL JS | Web-native map rendering, hex grid support |
| Backend | Node.js + WebSockets | Real-time army movements and combat |
| Database | PostgreSQL + PostGIS | Geospatial queries for hex lookups |
| Real-time | Socket.io | Player notifications, live map updates |
| Hosting | AWS / GCP | Scale as player base grows |

---

## Platform Targets

| Platform | How | When |
|----------|-----|------|
| Browser | React app directly | From day one |
| PC / Mac / Linux | Electron or Tauri wrapper | Pre-launch |
| Steam | Distribute the Electron/Tauri build | Launch |
| Mobile (iOS/Android) | Capacitor wrapper or React Native port | Post-launch |

One codebase. Wrap differently per platform. No rewrites.

---

## Phases

### Phase 1 — Map & World (Week 1-2)
Get the world on screen with a playable hex grid.

- [ ] Project setup (React + Mapbox GL JS)
- [ ] Render real-world map
- [ ] Overlay ~10km hex grid on world map
- [ ] Mark ocean hexes as uncapturable
- [ ] Basic hex selection and info panel
- [ ] Apply terrain flavor (mountains, desert, coastline) cosmetically

---

### Phase 2 — Player & Territory (Week 2-3)
Players exist and can own hexes.

- [ ] Auth (sign up / login)
- [ ] Player profile (name, faction color, capital)
- [ ] Starting hex selection with location suggestion
- [ ] Home region bonus zone (25 hex radius)
- [ ] Claim adjacent wildland hexes
- [ ] Hex ownership displayed on map
- [ ] Basic resource generation (gold + mana per hex per hour)

---

### Phase 3 — Economy & Buildings (Week 3-4)
Players can build and generate resources.

- [ ] Resource tick system (passive generation over time)
- [ ] Build Mines and Mana Wells on hexes
- [ ] Build Barracks (troop training speed)
- [ ] Build Watch Towers (early army detection)
- [ ] Overextension tax (diminishing returns past threshold)
- [ ] Rebellion mechanic (unattended hexes decay to Wildlands)

---

### Phase 4 — Military (Week 4-5)
Armies exist and can move.

- [ ] Recruit Knights, Archers, Trebuchets
- [ ] Global troop upgrades with Mana
- [ ] Army marching (1hr/hex knights/archers, 2hr/hex trebuchets)
- [ ] Cancel march before arrival
- [ ] Reinforce a hex mid-march
- [ ] Build Walls, Archer Towers, Mage Towers (defenses)
- [ ] Combat resolution on arrival
- [ ] Defenses destroyed on capture
- [ ] Capital cannot be destroyed, only captured

---

### Phase 5 — Alliances (Week 5-6)
Players can form and break political relationships.

- [ ] Send / accept alliance invitations
- [ ] Named alliance with shared map color border
- [ ] Shared map vision between allies
- [ ] Resource sending between allies
- [ ] Joint attack stacking on same hex
- [ ] Formal alliance dissolution with 24hr grace period
- [ ] Non-aggression pacts (lighter truce)

---

### Phase 6 — Notifications & Polish (Week 6-7)
Game feels alive and responsive.

- [ ] Push notifications (capital attack always on)
- [ ] Opt-in notifications: Watch Tower alerts, border crossings, alliance alerts
- [ ] Alliance leaderboard (combined territory)
- [ ] Player progression (level based on total territory held over time)
- [ ] Titles at milestones
- [ ] Historical map (greatest extent timeline)

---

### Phase 7 — Seasons & Balance (Week 7-8)
Long-term health of the game.

- [ ] Season system (3 month cycles, partial map reset)
- [ ] Season snapshot and cosmetic rewards
- [ ] Balance pass on resource rates, march speeds, combat math
- [ ] Stress test real-time with multiple simultaneous attacks

---

### Phase 8 — Monetization & Launch Prep
- [ ] Cosmetic shop (colors, banners, troop skins, map themes)
- [ ] Supporter tier (badge only, no gameplay advantage)
- [ ] Electron/Tauri desktop build
- [ ] Steam store page and submission
- [ ] App Store / Play Store submission (post-launch)
- [ ] Basic onboarding flow for new players

---

## Key Technical Challenges

1. **Hex grid on real map** — mapping ~1.5M land hexes onto Mapbox, only rendering visible ones (viewport culling)
2. **Real-time sync** — army positions updating live for all players without hammering the server
3. **Geospatial queries** — "find all hexes adjacent to this one", "find all hexes within 25 hex radius" — PostGIS handles this but needs careful indexing
4. **GPS spoofing** — if home region bonus matters, players may fake location. Detect and flag suspicious patterns.
5. **Scale** — start small, design DB schema to shard by region if needed

---

## MVP Definition

A shippable MVP needs Phases 1-5. That's the core game loop:
- See the world map
- Own territory
- Build economy
- Command armies
- Form alliances

Phases 6-8 make it polished and sustainable but are not blocking for a first playable version.
