-- S25/S27/S29 (ADR 0022). VIP points, tutorial and AFK payouts live in the ledger;
-- these tables keep summon guarantee counters, saved pull results (request_id
-- replay) and the AFK accumulation window with exact units (amount×ms).
CREATE TABLE summon_state (
  player_id uuid NOT NULL REFERENCES players(id),
  pool_id text NOT NULL CHECK (pool_id ~ '^[a-z][a-z0-9_]{2,79}$'),
  since_guarantee integer NOT NULL DEFAULT 0 CHECK (since_guarantee >= 0),
  total_pulls bigint NOT NULL DEFAULT 0 CHECK (total_pulls >= 0),
  PRIMARY KEY (player_id, pool_id)
);
CREATE TABLE summon_pulls (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id),
  request_id uuid NOT NULL,
  pool_id text NOT NULL,
  content_version text NOT NULL REFERENCES content_versions(content_version),
  pull_count integer NOT NULL CHECK (pull_count IN (1,10)),
  results jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, request_id)
);
CREATE TABLE afk_state (
  player_id uuid PRIMARY KEY REFERENCES players(id),
  window_started_at timestamptz NOT NULL,
  segment_at timestamptz NOT NULL,
  accrued_ms bigint NOT NULL DEFAULT 0 CHECK (accrued_ms >= 0),
  units jsonb NOT NULL DEFAULT '{}',
  rate jsonb NOT NULL DEFAULT '{}',
  rate_version text NOT NULL,
  rate_cleared integer NOT NULL DEFAULT 0
);
CREATE TABLE afk_claims (
  player_id uuid NOT NULL REFERENCES players(id),
  request_id uuid NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, request_id)
);
