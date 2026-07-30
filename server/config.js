// ─── Master game config ───────────────────────────────────────────────────────
// Single source of truth for pacing: MODE is 'dev' (fast, generous economy),
// 'test' (half dev speed - still much faster than prod, but slow enough that
// a season/economy doesn't run away from you between testing sessions), or
// 'prod' (real pacing). Defaults to 'dev' for anything unset/unrecognized -
// index.js's boot guard only enforces real secrets/config once MODE=prod is
// set explicitly.
import dotenv from 'dotenv'
dotenv.config()

const VALID_MODES = ['dev', 'test', 'prod']
const requested = (process.env.MODE || 'dev').toLowerCase()
export const MODE = VALID_MODES.includes(requested) ? requested : 'dev'
export const IS_DEV = MODE !== 'prod'
export const IS_TEST = MODE === 'test'
export const SPEED_DIV = IS_TEST ? 0.5 : 1
// IS_DEV/SPEED_DIV control PACING only (dev and test both run the clock fast).
// IS_SANDBOX is the separate question of whether the ECONOMY is real: only
// literal dev mode gets inflated starting resources, cheap costs, and loose
// balance thresholds. Test mode uses the exact same numbers as prod - it's
// meant to validate real balance at a fast clock, not be a cheat mode.
export const IS_SANDBOX = MODE === 'dev'

// ─── Starting resources ───────────────────────────────────────────────────────
export const STARTING_GOLD   = IS_SANDBOX ? 9999 : 100
export const STARTING_TROOPS = IS_SANDBOX ?   50 :  20
export const STARTING_MANA = 0  // mana removed - kept for DB compat

// ─── Resource tick ────────────────────────────────────────────────────────────
export const TICK_INTERVAL_MS = IS_DEV
  ? (30 * 1000) / SPEED_DIV        // 30 seconds (test mode: 15s)
  : 10 * 60 * 1000                 // 10 minutes

// ─── Building costs ───────────────────────────────────────────────────────────
export const BUILDING_COSTS = {
  mine:     { gold: IS_SANDBOX ?  5 : 50 },
  barracks: { gold: IS_SANDBOX ? 10 : 75 },
  fort:     { gold: IS_SANDBOX ? 10 : 80 },  // stationary defense - replaces archer_tower + watch_tower
}

// ─── Troop stats ──────────────────────────────────────────────────────────────
export const TROOP_STATS = {
  troop: {
    gold: IS_SANDBOX ? 1 : 10,
    trainMinutes:       IS_DEV ? 0.1  / SPEED_DIV : 3,   // base rate; barracks ÷2, none ×5 (net 10× gap)
    marchMinutesPerHex: IS_DEV ? 0.25 / SPEED_DIV : 25,
  },
}
// Training without a barracks is deliberately punishing: 5× the base rate,
// vs ÷2 with one - a 10× gap that makes barracks placement a real decision.
export const NO_BARRACKS_TRAIN_MULT = 5

// World Wonder keeper income, per wonder per tick. Flat wherever the wonder
// stands: a remote Fuji pays the same as the Eiffel Tower in the Paris zone,
// so wonder-hunting pulls players away from the city hotspots, not into them.
export const WONDER_INCOME_GOLD = 10

// ─── Combat ───────────────────────────────────────────────────────────────────
// A fort lets 3 of the defender's frontline troops fight with advantage
// (roll 2 dice, take the higher) each clash - see combat.js for why this is
// bounded and additive (MAX_ADVANTAGED_DEFENDERS) rather than a raw frontline
// capacity increase, which turned out to be exploitable.
export const FORT_ADVANTAGE_TROOPS = 3
// Fixed cadence between dice clashes - kept constant (not scaled by army size
// beyond the dev/test speed-up) so battle duration stays a clean, testable
// function of reserve depth: see combat.js resolveBattleClash.
export const BATTLE_INTERVAL_MS = IS_DEV ? (10 * 1000) / SPEED_DIV : 60 * 1000

// ─── Ocean travel ─────────────────────────────────────────────────────────────
export const OCEAN_MARCH_MULTIPLIER = 10  // ocean hexes cost 10× march time

// ─── Building slots ───────────────────────────────────────────────────────────
export const SLOT_BASE       = 2
export const SLOT_CAPITAL    = 4
export const SLOT_UPGRADE    = 2
export const MAX_UPGRADE_LEVEL   = 1
export const MAX_BARRACKS_PER_HEX = 1

export const UPGRADE_COST    = { gold: IS_SANDBOX ? 20 : 300 }
export const UPGRADE_MINUTES = IS_DEV ? 0.5 / SPEED_DIV : 45

// ─── Building construction time ───────────────────────────────────────────────
export const BUILDING_TIME_SECONDS = IS_DEV ? 30 / SPEED_DIV : 300  // 30s dev, 5 min prod

// ─── Resource caps ────────────────────────────────────────────────────────────
export const GOLD_CAP_BASE     = IS_SANDBOX ? 99999 :  500
export const GOLD_CAP_PER_HEX  = IS_SANDBOX ?  9999 :  100
export const GOLD_CAP_PER_MINE = IS_SANDBOX ?  9999 :   50

// ─── Neutral camps (PvE on-ramp) ──────────────────────────────────────────────
export const CAMPS_PER_SPAWN    = 3                    // camps seeded around each new capital
export const CAMP_GARRISON_MIN  = IS_SANDBOX ?  5 :  8
export const CAMP_GARRISON_MAX  = IS_SANDBOX ? 12 : 18
export const CAMP_LOOT_GOLD     = IS_SANDBOX ? 20 : 40   // plunder for capturing a camp

// Country-capital hexes (Paris, Tokyo, etc.) start each season under a bigger
// Wildlands garrison than regular camps - the crown-eligible prize should go
// to whoever can field a real army, not whoever clicks fastest after a reset.
export const CAPITAL_GARRISON_MIN = IS_SANDBOX ? 20 : 40
export const CAPITAL_GARRISON_MAX = IS_SANDBOX ? 35 : 70

// ─── Entrenchment - defense from compact borders ──────────────────────────────
export const ENTRENCH_ADVANTAGE_PER_NEIGHBOR = 1  // +1 advantaged defender per adjacent friendly hex
export const ENTRENCH_MAX_NEIGHBORS          = 4  // capped at +4

// ─── Border decay - anti-blob ─────────────────────────────────────────────────
export const DECAY_HEX_THRESHOLD = IS_SANDBOX ? 12 : 30  // empires above this size start decaying
export const DECAY_CHANCE        = 0.15                // per eligible border hex per tick
export const DECAY_MAX_PER_TICK  = 3                   // at most N hexes lost per player per tick
// A hex needs at least this many troops to be decay-safe, and the bar rises
// as the empire grows: +1 required troop for every DECAY_SCALE_HEXES_PER_STEP
// hexes owned beyond DECAY_HEX_THRESHOLD. A single token troop only ever
// protects a genuinely small empire - sprawling wide raises your own bar.
export const DECAY_SCALE_HEXES_PER_STEP = 10           // +1 required garrison per 10 hexes over the threshold

// The decay-safe garrison size for a player with this many hexes - 0 (no
// requirement) at or below the threshold, then +1 per DECAY_SCALE_HEXES_PER_STEP
// hexes past it. Shared by tick.js (enforcement) and the client (display via
// /api/health's exported constants) so the two can never disagree.
export function requiredGarrisonForHexCount(hexCount) {
  if (hexCount <= DECAY_HEX_THRESHOLD) return 0
  return 1 + Math.floor((hexCount - DECAY_HEX_THRESHOLD) / DECAY_SCALE_HEXES_PER_STEP)
}

// ─── Claiming ─────────────────────────────────────────────────────────────────
// An unclaimed hex needs a real commitment to take, not a single scout troop -
// this is what actually stops "spread everywhere with 1 troop," rather than
// just making it decay slowly afterward.
export const MIN_TROOPS_TO_CLAIM = 5

// ─── Country crowns ───────────────────────────────────────────────────────────
export const CROWN_MIN_HEXES = IS_SANDBOX ? 3 : 10  // hexes in-country (plus its capital) to be crowned

// ─── Notifications ─────────────────────────────────────────────────────────────
// Web push ships behind a flag so it can be killed instantly (annoying users,
// device-cert issues, etc.) without touching VAPID keys. Default on.
export const NOTIFICATIONS_ENABLED = process.env.NOTIFICATIONS_ENABLED !== 'false'

// ─── Alliances ────────────────────────────────────────────────────────────────
export const ALLIANCE_CREATE_COST = IS_SANDBOX ? 10 : 100
export const CHAT_MAX_LENGTH      = 240
// Chat ships behind a flag: no moderation yet, so it stays off unless
// explicitly enabled (set CHAT_ENABLED=true and VITE_CHAT_ENABLED=true).
export const CHAT_ENABLED         = process.env.CHAT_ENABLED === 'true'

// ─── Power projection - huge forces can't hide in the fog ─────────────────────
export const PROJECTION_GARRISON = IS_SANDBOX ? 30 : 250    // a garrison this big is visible through fog
export const PROJECTION_EMPIRE   = IS_SANDBOX ? 120 : 2500  // total troops at which your whole empire is exposed

// ─── Seasons ──────────────────────────────────────────────────────────────────
// When a season ends: standings are frozen, a Champion is crowned, and the map
// resets for a new age. Accounts, alliances, and history persist.
export const SEASON_DURATION_MS = IS_DEV
  ? (30 * 24 * 60 * 60 * 1000) / SPEED_DIV   // 30 days - force-end early from the admin portal when you need a rollover
  : 90 * 24 * 60 * 60 * 1000                 // 90 days

// Podium gold carried into the new age (1st, 2nd, 3rd)
export const SEASON_PODIUM_BONUS = [100, 50, 25]
