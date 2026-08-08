-- RealmWar - database schema
-- Prerequisites: PostgreSQL 14+
-- Usage: psql -d realmwar -f schema.sql

CREATE TABLE IF NOT EXISTS players (
  id               SERIAL PRIMARY KEY,
  username         TEXT        NOT NULL UNIQUE,
  password_hash    TEXT        NOT NULL,
  color            TEXT        NOT NULL DEFAULT '#4a90d9',
  gold             INTEGER     NOT NULL DEFAULT 100,
  mana             INTEGER     NOT NULL DEFAULT 0,
  capital_hex      TEXT,
  last_login_date  DATE,
  login_streak     INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hexes (
  h3_index      TEXT        PRIMARY KEY,
  owner_id      INTEGER     NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  claimed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  upgrade_level INTEGER     NOT NULL DEFAULT 0,
  rally_hex     TEXT
);

CREATE TABLE IF NOT EXISTS buildings (
  id         SERIAL      PRIMARY KEY,
  h3_index   TEXT        NOT NULL,
  type       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS troops (
  owner_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  h3_index TEXT    NOT NULL,
  type     TEXT    NOT NULL DEFAULT 'troop',
  quantity INTEGER NOT NULL DEFAULT 0,
  UNIQUE (owner_id, h3_index, type)
);

CREATE TABLE IF NOT EXISTS armies (
  id          SERIAL      PRIMARY KEY,
  owner_id    INTEGER     NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  from_hex    TEXT        NOT NULL,
  to_hex      TEXT        NOT NULL,
  type        TEXT        NOT NULL DEFAULT 'troop',
  quantity    INTEGER     NOT NULL,
  arrives_at  TIMESTAMPTZ NOT NULL,
  departed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status      TEXT        NOT NULL DEFAULT 'marching',
  -- The actual weighted-shortest-path route (marchPath.js), computed once at
  -- march creation and stored rather than re-derived per query - both so
  -- position/beam rendering always matches exactly what arrives_at was
  -- computed from, and so re-running A* isn't needed every time an army's
  -- current position is queried.
  path        TEXT[]
);

CREATE TABLE IF NOT EXISTS battles (
  id                SERIAL      PRIMARY KEY,
  h3_index          TEXT        NOT NULL,
  attacker_id       INTEGER     NOT NULL REFERENCES players(id),
  defender_id       INTEGER     NOT NULL REFERENCES players(id),
  attacker_strength NUMERIC     NOT NULL DEFAULT 0,
  defender_strength NUMERIC     NOT NULL DEFAULT 0,
  attacker_troops   NUMERIC     NOT NULL DEFAULT 0,
  defender_troops   NUMERIC     NOT NULL DEFAULT 0,
  def_multiplier    NUMERIC     NOT NULL DEFAULT 1,
  attacker_losses   NUMERIC     NOT NULL DEFAULT 0,
  defender_losses   NUMERIC     NOT NULL DEFAULT 0,
  round_number      INTEGER     NOT NULL DEFAULT 0,
  last_round_at     TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  status            TEXT        NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS battle_participants (
  id         SERIAL      PRIMARY KEY,
  battle_id  INTEGER     NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  player_id  INTEGER     NOT NULL REFERENCES players(id),
  side       TEXT        NOT NULL,
  troop_type TEXT        NOT NULL DEFAULT 'troop',
  quantity   INTEGER     NOT NULL,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS training_queue (
  id           SERIAL      PRIMARY KEY,
  owner_id     INTEGER     NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  h3_index     TEXT        NOT NULL,
  type         TEXT        NOT NULL DEFAULT 'troop',
  quantity     INTEGER     NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL,
  completes_at TIMESTAMPTZ NOT NULL,
  delivered    INTEGER     NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS upgrade_queue (
  id           SERIAL      PRIMARY KEY,
  owner_id     INTEGER     NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  h3_index     TEXT        NOT NULL,
  completes_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id         SERIAL      PRIMARY KEY,
  player_id  INTEGER     NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type       TEXT        NOT NULL,
  message    TEXT        NOT NULL,
  hex_index  TEXT,
  read       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hex_history (
  id          SERIAL      PRIMARY KEY,
  player_id   INTEGER     NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  hex_count   INTEGER     NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Web push subscriptions (one row per browser/device)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         SERIAL      PRIMARY KEY,
  player_id  INTEGER     NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  endpoint   TEXT        NOT NULL UNIQUE,
  keys       JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Global newspaper feed (public)
CREATE TABLE IF NOT EXISTS world_events (
  id         SERIAL      PRIMARY KEY,
  type       TEXT        NOT NULL,
  message    TEXT        NOT NULL,
  hex_index  TEXT,
  player_id  INTEGER     REFERENCES players(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Current ruler of each country (own its capital + enough hexes)
CREATE TABLE IF NOT EXISTS country_crowns (
  country    TEXT        PRIMARY KEY,
  player_id  INTEGER     NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  crowned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alliances (
  id         SERIAL      PRIMARY KEY,
  name       TEXT        NOT NULL UNIQUE,
  tag        TEXT        NOT NULL UNIQUE,
  code       TEXT        NOT NULL UNIQUE,
  created_by INTEGER     REFERENCES players(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE players ADD COLUMN IF NOT EXISTS alliance_id INTEGER REFERENCES alliances(id) ON DELETE SET NULL;
ALTER TABLE players ADD COLUMN IF NOT EXISTS flag_pixels TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS motto TEXT;

-- Chat: alliance_id NULL = global channel
CREATE TABLE IF NOT EXISTS chat_messages (
  id          SERIAL      PRIMARY KEY,
  player_id   INTEGER     NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  alliance_id INTEGER     REFERENCES alliances(id) ON DELETE CASCADE,
  text        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seasons: timed ages of the world; ending crowns a Champion and resets the map
CREATE TABLE IF NOT EXISTS seasons (
  id             SERIAL      PRIMARY KEY,
  number         INTEGER     NOT NULL UNIQUE,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at        TIMESTAMPTZ NOT NULL,
  ended_at       TIMESTAMPTZ,
  status         TEXT        NOT NULL DEFAULT 'active',
  winner_id      INTEGER     REFERENCES players(id) ON DELETE SET NULL,
  snapshot       JSONB,
  hex_resolution INTEGER     NOT NULL DEFAULT 7,
  -- Season-total activity stats (battles fought, troops lost, final
  -- territory) - kept separate from `snapshot` (the standings array, which
  -- player-facing UI already reads as a bare array) rather than folded in,
  -- so adding this never risks changing snapshot's shape for existing
  -- consumers. Cheap: aggregated from battles/hexes right before the
  -- season-end wipe deletes those rows, not tracked incrementally.
  stats          JSONB
);

-- Single-row table: admin-set overrides for the *next* season only (H3
-- resolution, duration in days). Each is consumed (reset to NULL) the moment
-- a new season is created, so it never silently carries over past the one
-- season it was set for.
CREATE TABLE IF NOT EXISTS season_config (
  id                   INTEGER PRIMARY KEY DEFAULT 1,
  next_hex_resolution  INTEGER,
  next_season_days     INTEGER,
  CONSTRAINT season_config_singleton CHECK (id = 1)
);

-- World Wonders: last-known holder of each landmark hex (ownership itself
-- lives in hexes; this table lets the 15s poll detect and announce seizures)
CREATE TABLE IF NOT EXISTS wonder_holders (
  h3_index VARCHAR(20) PRIMARY KEY,
  owner_id INTEGER     NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Champion's Monuments: permanent, one per season, never wiped.
-- username/color are copied (not FKs) so a monument outlives its account.
CREATE TABLE IF NOT EXISTS monuments (
  id            SERIAL      PRIMARY KEY,
  season_number INTEGER     NOT NULL UNIQUE,
  username      TEXT        NOT NULL,
  color         TEXT,
  h3_index      VARCHAR(20) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Wonder history: every seizure of a wonder, forever - the landmark's chronicle.
-- username/color are copied (not FKs) so history survives accounts and wipes.
CREATE TABLE IF NOT EXISTS wonder_history (
  id        SERIAL      PRIMARY KEY,
  h3_index  VARCHAR(20) NOT NULL,
  username  TEXT        NOT NULL,
  color     TEXT,
  seized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wonder_history_hex ON wonder_history (h3_index, seized_at DESC);
