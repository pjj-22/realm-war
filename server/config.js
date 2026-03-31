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
  mine:         { gold: DEV_MODE ?  5 : 50,  mana: 0 },
  mana_well:    { gold: DEV_MODE ?  5 : 50,  mana: 0 },
  barracks:     { gold: DEV_MODE ? 10 : 75,  mana: 0 },
  watch_tower:  { gold: DEV_MODE ?  5 : 60,  mana: 0 },
  archer_tower: { gold: DEV_MODE ? 10 : 80,  mana: DEV_MODE ? 0 : 20 },
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

// ─── Troop role bonuses ───────────────────────────────────────────────────────
// Multiplier applied to combat strength based on role in battle.
export const TROOP_ROLE_BONUS = {
  knight:    { attacker: 1.0, defender: 1.0 },
  archer:    { attacker: 1.0, defender: 1.25 },
  trebuchet: { attacker: 1.5, defender: 1.0 },
}

// ─── Building slots ───────────────────────────────────────────────────────────
export const SLOT_BASE = 2          // slots on a regular hex
export const SLOT_CAPITAL = 4       // slots on your capital hex
export const SLOT_UPGRADE = 2       // extra slots per upgrade level
export const MAX_UPGRADE_LEVEL = 1  // upgrade once max
export const MAX_BARRACKS_PER_HEX = 1

export const UPGRADE_COST = { gold: DEV_MODE ? 20 : 300, mana: DEV_MODE ? 5 : 100 }
export const UPGRADE_MINUTES = DEV_MODE ? 0.5 : 45

// ─── Resource caps ────────────────────────────────────────────────────────────
// Gold cap = base + per-hex * hexes + per-mine * mines
// Mana cap = base + per-well * wells
export const GOLD_CAP_BASE     = DEV_MODE ? 99999 :  500
export const GOLD_CAP_PER_HEX  = DEV_MODE ?  9999 :  100
export const GOLD_CAP_PER_MINE = DEV_MODE ?  9999 :   50
export const MANA_CAP_BASE     = DEV_MODE ? 99999 :  100
export const MANA_CAP_PER_WELL = DEV_MODE ?  9999 :   75

// ─── Building defense bonuses ─────────────────────────────────────────────────
// Archer Tower: multiplies defender strength when the hex is attacked.
export const ARCHER_TOWER_DEFENSE_BONUS = 0.3 // +30% defender strength per tower

// ─── Battle rounds ────────────────────────────────────────────────────────────
// Fraction of current strength lost per round (every 15s).
// At 0.15: a balanced fight lasts ~7 rounds (~105s dev, real-time).
export const BATTLE_ROUND_DAMAGE_RATE = 0.15
