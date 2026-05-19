// ─── Master game config ───────────────────────────────────────────────────────
// Set DEV_MODE=true for fast local testing, false for real game speeds.
export const DEV_MODE = true

// ─── Starting resources ───────────────────────────────────────────────────────
export const STARTING_GOLD   = DEV_MODE ? 9999 : 100
export const STARTING_TROOPS = DEV_MODE ?   50 :  20
export const STARTING_MANA = 0  // mana removed — kept for DB compat

// ─── Resource tick ────────────────────────────────────────────────────────────
export const TICK_INTERVAL_MS = DEV_MODE
  ? 30 * 1000        // 30 seconds
  : 10 * 60 * 1000   // 10 minutes

// ─── Building costs ───────────────────────────────────────────────────────────
export const BUILDING_COSTS = {
  mine:     { gold: DEV_MODE ?  5 : 50 },
  barracks: { gold: DEV_MODE ? 10 : 75 },
  fort:     { gold: DEV_MODE ? 10 : 80 },  // stationary defense — replaces archer_tower + watch_tower
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
