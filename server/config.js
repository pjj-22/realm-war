// ─── Master game config ───────────────────────────────────────────────────────
// Set DEV_MODE=true for fast local testing, false for real game speeds.
export const DEV_MODE = true

// ─── Starting resources ───────────────────────────────────────────────────────
export const STARTING_GOLD = DEV_MODE ? 9999 : 100
export const STARTING_MANA = DEV_MODE ? 9999 : 50

// ─── Resource tick ────────────────────────────────────────────────────────────
// How often gold/mana are awarded for owned hexes + buildings.
export const TICK_INTERVAL_MS = DEV_MODE
  ? 30 * 1000        // 30 seconds
  : 10 * 60 * 1000   // 10 minutes

// ─── Building costs ───────────────────────────────────────────────────────────
export const BUILDING_COSTS = {
  mine:        { gold: DEV_MODE ?  5 : 50,  mana: 0 },
  mana_well:   { gold: DEV_MODE ?  5 : 50,  mana: 0 },
  barracks:    { gold: DEV_MODE ? 10 : 75,  mana: 0 },
  watch_tower: { gold: DEV_MODE ?  5 : 60,  mana: 0 },
}

// ─── Troop stats ──────────────────────────────────────────────────────────────
// trainMinutes: time to train 1 unit (multiplied by quantity)
// marchMinutesPerHex: travel time per hex of grid distance
export const TROOP_STATS = {
  knight: {
    gold: DEV_MODE ? 1 : 10,
    mana: 0,
    trainMinutes:      DEV_MODE ? 0.1  : 3,
    marchMinutesPerHex: DEV_MODE ? 0.25 : 60,
  },
  archer: {
    gold: DEV_MODE ? 1 : 10,
    mana: 0,
    trainMinutes:      DEV_MODE ? 0.1  : 3,
    marchMinutesPerHex: DEV_MODE ? 0.25 : 60,
  },
  trebuchet: {
    gold: DEV_MODE ? 5 : 30,
    mana: DEV_MODE ? 0 : 10,
    trainMinutes:      DEV_MODE ? 0.2  : 8,
    marchMinutesPerHex: DEV_MODE ? 0.5  : 120,
  },
}

// ─── Combat strength ─────────────────────────────────────────────────────────
export const COMBAT_STRENGTH = { knight: 1, archer: 1.2, trebuchet: 3 }

// ─── Battle rounds ────────────────────────────────────────────────────────────
// Fraction of current strength lost per round (every 15s).
// At 0.15: a balanced fight lasts ~7 rounds (~105s dev, real-time).
export const BATTLE_ROUND_DAMAGE_RATE = 0.15
