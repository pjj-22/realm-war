# Realm War — Game Design Document
*Version 0.1 — Draft*

---

## Overview

**Realm War** is a persistent, global, real-time territory strategy game played on a real-world map. The entire Earth is the battlefield. Players build fantasy empires, command armies, forge alliances, and wage perpetual war for control of the world's geography.

There is no end state. The war never ends.

---

## Core Fantasy

You open the app and see the actual world map — continents, countries, cities — carved up and glowing with the colors of rival factions. You control a small piece of it. Your mines generate resources. Your armies hold your borders. Somewhere on the other side of the world, an alliance you've never met is marching toward your territory.

---

## Core Loop

1. **Claim nodes** on the real-world map
2. **Build mines** on claimed nodes to generate resources
3. **Spend resources** to recruit and upgrade troops
4. **Attack** neighboring nodes to expand territory
5. **Defend** your territory from attackers
6. **Form alliances** to coordinate large-scale campaigns
7. Repeat — forever

---

## The Map

- The real-world map is the game board (powered by Mapbox or similar)
- The map is divided into a **hex grid** overlaid on top of real geography (~10km per hex, ~1.5 million total land hexes)
- Hexes roughly correspond to real regions — oceans are uncapturable, land is the battlefield
- Hexes have **visual flavor** based on real terrain (mountains, forests, desert, coastline) — cosmetic but adds immersion
- Players can only attack **adjacent hexes** — no teleporting armies

### Node Types (within hexes)
| Type | Description |
|------|-------------|
| **Nexus** | High-value strategic point, generates more resources, harder to take |
| **Mine** | Built by player, generates gold/mana over time |
| **Fortress** | Built by player, defensive bonus |
| **Wildlands** | Unclaimed hex, easy to take |

---

## Resources

Two resources keep things simple:

- **Gold** — recruits troops, builds structures
- **Mana** — upgrades troops, powers special abilities

Both are generated passively over time by owned hexes and mines. Rate scales with territory size but with **diminishing returns** (see Balance section).

---

## Troops

Three unit types, each with a distinct role. No unit is universally dominant.

| Unit | Cost | Role | Counters | Weak Against |
|------|------|------|----------|--------------|
| **Knights** | Gold | Frontline assault, high HP | Trebuchets (breaks walls for them) | Archers |
| **Archers** | Gold | Ranged, low HP | Knights (outrange them) | Trebuchets |
| **Trebuchets** | Gold + Mana | Siege, slow moving | Walls & Towers (required to break them) | Archers (fragile up close) |

### Key Rules
- Troops are **consumed in combat** — win or lose, you spend them
- Troops **regenerate slowly** on defended hexes over time
- Each unit type can be **upgraded globally** with Mana — improves stats for all units of that type across your empire
- Trebuchets **march slowly** — a siege force takes longer to arrive than a knight rush

---

## Defenses

Built on owned hexes. Defenses are **destroyed when a hex is captured** — the attacker gets nothing.

| Defense | Cost | Effect | Countered By |
|---------|------|--------|--------------|
| **Walls** | Gold | Greatly increases hex HP, blocks knight rushes | Trebuchets |
| **Archer Towers** | Gold | Passive ranged damage to all attackers | Trebuchets (outranged) |
| **Mage Tower** | Mana | Reduces attacking army strength by X% before combat lands | Archers (target the mages) |

### Combat Triangle in Practice
- A knight rush hits a **walled hex** — stalls without trebuchets
- Trebuchets crack the walls but are shredded by **archer towers** if you don't bring archers
- Archers cover the trebuchets but a **mage tower** weakens the whole force before it engages
- Attacker must bring a **balanced force** to take a well-defended hex

---

## Economy Buildings

Built on owned hexes, one building per hex.

| Building | Effect |
|----------|--------|
| **Mine** | +Gold/hr |
| **Mana Well** | +Mana/hr |
| **Barracks** | +Troop training speed |
| **Watch Tower** | Reveals incoming armies earlier, giving more response time |

Economy buildings are also **destroyed on capture**.

---

## Alliance System

Alliances are the political heart of the game.

### Forming an Alliance
- Any player can **invite** another to form an alliance
- Both must **formally accept** — creates a named, visible alliance on the map
- Alliance members' territories show a **shared color border**
- Alliance members **cannot attack each other**
- Alliances can have a **charter** (text field) — flavor, rules, goals

### Alliance Benefits
- Shared map vision (see each other's troop movements)
- Can send resources to allies
- Coordinate joint attacks on the same hex simultaneously (stacked forces)
- Alliance leaderboard — combined territory size

### Breaking an Alliance
- Either party can **formally declare dissolution**
- There is a **24-hour grace period** after declaration — both sides are notified, no attacks allowed between them during this window
- After 24 hours the alliance is broken and war can begin
- **Betrayal** (attacking an ally before formal dissolution) is technically impossible by design — the game enforces the grace period

### Alliances as Protection
- Since there are no offline shields, **allies are your only protection while you sleep**
- A player in a strong alliance has allies in other time zones watching their borders
- This makes alliances feel essential, not optional — real political dependency

### Alliance Limits
- A player can be in **one primary alliance** at a time
- Smaller **non-aggression pacts** can be formed with others (no shared vision, just a truce)

---

## Power Balance — The Core Problem

> *"One player gets super powerful and never loses"* — this must be prevented by design.

### Mechanisms

**1. Overextension Tax**
- Holding more hexes increases **upkeep cost**
- Past a threshold, each additional hex costs more to maintain than it generates
- Forces players to choose depth (upgrade, fortify) over infinite breadth

**2. Defensive Scaling**
- Attacking is always more expensive than defending
- The larger a player's empire, the more border hexes they have to defend
- Large empires are inherently vulnerable — many fronts, spread thin

**3. The Capital**
- Every player has one designated **Capital hex** — their seat of power
- The Capital has a massive built-in defense bonus and cannot be destroyed, only captured
- If all your territory is taken, you still hold your Capital and can rebuild from it
- You are never truly eliminated — just reduced

**4. Slow Marching**
- Armies don't teleport — they **march hex by hex in real time**
- **Knights & Archers** move at **1 hour per hex**
- **Trebuchets** move at **2 hours per hex** — a siege is a deliberate commitment
- Attacking deep into enemy territory takes many hours, crossing a continent takes days
- Wiping a player overnight requires sustained, coordinated effort — not a single attack
- This naturally limits how fast you can be destroyed, no shield needed

**5. Rebellion Mechanic**
- Hexes held for a very long time without investment slowly lose loyalty
- Unattended territory can **flip to Wildlands** over time, needing recapture
- Keeps dominant players actively engaged or they decay

**5. No Pay-to-Win**
- Resources cannot be purchased with real money
- Only cosmetics are purchasable (colors, banners, troop skins)

---

## Progression

Since the game is perpetual, progression is personal:

- **Player Level** — based on total territory held over time (not current — prevents grief)
- **Titles** — unlocked at milestones ("Warlord", "Archmage", "Emperor")
- **Historical Map** — a timeline of your empire's greatest extent
- **Alliance Hall of Fame** — top alliances by peak territory

---

## Seasons (Optional Layer)

Every 3 months, a **Season** ends:
- A snapshot of the current map is saved as that season's "final state"
- Season winners (top alliances/players by territory) get cosmetic rewards
- The map **partially resets** — not fully wiped, but some territory reverts to Wildlands
- Keeps the game fresh, prevents permanent lock-in by early dominant players

---

## Monetization

- **Free to play, no pay-to-win**
- Cosmetic purchases only:
  - Custom faction colors/banners
  - Troop skins (knights become samurai, etc.)
  - Map themes (dark mode, ancient map aesthetic)
- Optional **supporter tier** — small monthly fee for profile badge and priority customer support, nothing gameplay-affecting

---

## Platform

- Mobile first (iOS + Android)
- Web client secondary (for map watching / alliance management)
- No AR camera required — the map IS the game

---

## Technical Stack (Preliminary)

| Layer | Technology |
|-------|-----------|
| Mobile | React Native |
| Map | Mapbox SDK |
| Backend | Node.js + WebSockets |
| Database | PostgreSQL + PostGIS |
| Real-time | Socket.io or similar |
| Hosting | AWS / GCP |

---

## Open Questions

- [x] ~~What is the hex size?~~ **~10km per hex** (~1.5 million total land hexes globally). Can be adjusted as player base grows.
- [ ] How many players per "server" — one global server or regional shards?
- [x] ~~Combat resolution~~ **Time-based marching.** Armies travel in real time hex by hex. Combat resolves on arrival. Defenders can reinforce during the march window. Watch Towers reveal incoming armies early giving defenders response time.
- [x] ~~Starting territories~~ **Suggested placement near player's real location with a home region bonus.** Bonus zone is a ~25 hex radius (~Colorado-sized) around the starting hex. Within this zone: +resource generation, +march speed, +defense. Players can ignore the suggestion and start elsewhere but forfeit the bonus.
- [x] ~~Notifications~~ **Capital attack notifications always on. Everything else opt-in per type:** Watch Tower alerts, border crossing alerts, alliance-under-attack alerts. Lets players tune to their play style.

---

*This document is a living draft. Mechanics should be playtested and adjusted.*
