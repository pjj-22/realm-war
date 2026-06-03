-- RealmWar — database schema
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
  status      TEXT        NOT NULL DEFAULT 'marching'
);

CREATE TABLE IF NOT EXISTS battles (
  id                SERIAL      PRIMARY KEY,
  h3_index          TEXT        NOT NULL,
  attacker_id       INTEGER     NOT NULL REFERENCES players(id),
  defender_id       INTEGER     NOT NULL REFERENCES players(id),
  attacker_strength NUMERIC     NOT NULL DEFAULT 0,
  defender_strength NUMERIC     NOT NULL DEFAULT 0,
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
  completes_at TIMESTAMPTZ NOT NULL
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
