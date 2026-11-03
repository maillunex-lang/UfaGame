-- S22: campaign progress. A stage is cleared once per player; the first-clear
-- reward is paid in the same transaction as the winning battle step through the
-- ledger with key campaign:first:<stage_id> (no duplicates, no client trust).
CREATE TABLE campaign_progress (
  player_id uuid NOT NULL REFERENCES players(id),
  stage_id text NOT NULL CHECK (stage_id ~ '^[a-z][a-z0-9_]{2,79}$'),
  content_version text NOT NULL REFERENCES content_versions(content_version),
  battle_id uuid NOT NULL UNIQUE REFERENCES live_battles(id),
  cleared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, stage_id)
);
