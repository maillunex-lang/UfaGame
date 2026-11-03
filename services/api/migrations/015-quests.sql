-- S30 (ADR 0023). Each server event is counted once per player (event key); quest
-- progress is kept per period (daily: Ufa date, once: ''); rewards go through the
-- ledger with keys derived from quest and period.
CREATE TABLE quest_event_keys (
  player_id uuid NOT NULL REFERENCES players(id),
  event_key text NOT NULL CHECK (length(event_key) BETWEEN 3 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, event_key)
);
CREATE TABLE quest_progress (
  player_id uuid NOT NULL REFERENCES players(id),
  quest_id text NOT NULL CHECK (quest_id ~ '^[a-z][a-z0-9_]{2,79}$'),
  period text NOT NULL CHECK (period = '' OR period ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0),
  claimed_at timestamptz,
  PRIMARY KEY (player_id, quest_id, period)
);
