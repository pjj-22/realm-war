// ─── Master game config ───────────────────────────────────────────────────────
// Set DEV_MODE=true for fast local testing, false for real game speeds.
export const DEV_MODE = true

// ─── Starting resources ───────────────────────────────────────────────────────
export const STARTING_GOLD   = DEV_MODE ? 9999 : 100
export const STARTING_TROOPS = DEV_MODE ?   50 :  20
export const STARTING_MANA = 0  // mana removed - kept for DB compat

// ─── Resource tick ────────────────────────────────────────────────────────────
export const TICK_INTERVAL_MS = DEV_MODE
  ? 30 * 1000        // 30 seconds
  : 10 * 60 * 1000   // 10 minutes

// ─── Building costs ───────────────────────────────────────────────────────────
export const BUILDING_COSTS = {
  mine:     { gold: DEV_MODE ?  5 : 50 },
  barracks: { gold: DEV_MODE ? 10 : 75 },
  fort:     { gold: DEV_MODE ? 10 : 80 },  // stationary defense - replaces archer_tower + watch_tower
}

// ─── Troop stats ──────────────────────────────────────────────────────────────
export const TROOP_STATS = {
  troop: {
    gold: DEV_MODE ? 1 : 10,
    trainMinutes:       DEV_MODE ? 0.1  : 3,
    marchMinutesPerHex: DEV_MODE ? 0.25 : 60,
  },
}

// ─── Combat ───────────────────────────────────────────────────────────────────
export const FORT_DEFENSE_BONUS     = 0.4   // +40% defender strength per fort
export const BATTLE_ROUND_DAMAGE_RATE = 0.15  // fraction of strength lost per round

// ─── Ocean travel ─────────────────────────────────────────────────────────────
export const OCEAN_MARCH_MULTIPLIER = 10  // ocean hexes cost 10× march time

// ─── Building slots ───────────────────────────────────────────────────────────
export const SLOT_BASE       = 2
export const SLOT_CAPITAL    = 4
export const SLOT_UPGRADE    = 2
export const MAX_UPGRADE_LEVEL   = 1
export const MAX_BARRACKS_PER_HEX = 1

export const UPGRADE_COST    = { gold: DEV_MODE ? 20 : 300 }
export const UPGRADE_MINUTES = DEV_MODE ? 0.5 : 45

// ─── Building construction time ───────────────────────────────────────────────
export const BUILDING_TIME_SECONDS = DEV_MODE ? 30 : 300  // 30s dev, 5 min prod

// ─── Resource caps ────────────────────────────────────────────────────────────
export const GOLD_CAP_BASE     = DEV_MODE ? 99999 :  500
export const GOLD_CAP_PER_HEX  = DEV_MODE ?  9999 :  100
export const GOLD_CAP_PER_MINE = DEV_MODE ?  9999 :   50

// ─── Neutral camps (PvE on-ramp) ──────────────────────────────────────────────
export const CAMPS_PER_SPAWN    = 3                    // camps seeded around each new capital
export const CAMP_GARRISON_MIN  = DEV_MODE ?  5 :  8
export const CAMP_GARRISON_MAX  = DEV_MODE ? 12 : 18
export const CAMP_LOOT_GOLD     = DEV_MODE ? 20 : 40   // plunder for capturing a camp

// ─── Entrenchment - defense from compact borders ──────────────────────────────
export const ENTRENCH_BONUS_PER_NEIGHBOR = 0.08  // +8% defender strength per adjacent friendly hex
export const ENTRENCH_MAX_NEIGHBORS      = 4     // capped at +32%

// ─── Border decay - anti-blob ─────────────────────────────────────────────────
export const DECAY_HEX_THRESHOLD = DEV_MODE ? 12 : 30  // empires above this size start decaying
export const DECAY_CHANCE        = 0.15                // per eligible border hex per tick
export const DECAY_MAX_PER_TICK  = 3                   // at most N hexes lost per player per tick

// ─── Country crowns ───────────────────────────────────────────────────────────
export const CROWN_MIN_HEXES = DEV_MODE ? 3 : 10  // hexes in-country (plus its capital) to be crowned

// ─── Alliances ────────────────────────────────────────────────────────────────
export const ALLIANCE_CREATE_COST = DEV_MODE ? 10 : 100
export const CHAT_MAX_LENGTH      = 240

// ─── Seasons ──────────────────────────────────────────────────────────────────
// When a season ends: standings are frozen, a Champion is crowned, and the map
// resets for a new age. Accounts, alliances, and history persist.
export const SEASON_DURATION_MS = DEV_MODE
  ? 5 * 60 * 1000              // 5 minutes - watch a full season roll over while testing
  : 90 * 24 * 60 * 60 * 1000   // 90 days
