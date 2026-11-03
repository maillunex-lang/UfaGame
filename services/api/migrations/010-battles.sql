-- S17: server-authoritative battles pinned to a published content version.
-- No rewards are granted here; rewards belong to campaign stages (S22/S23).
CREATE TABLE battles (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id),
  request_id uuid NOT NULL,
  content_version text NOT NULL REFERENCES content_versions(content_version),
  stage_id text NOT NULL CHECK (stage_id ~ '^[a-z][a-z0-9_]{2,79}$'),
  hero_ids text[] NOT NULL CHECK (cardinality(hero_ids) BETWEEN 1 AND 5),
  seed bigint NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
  result text NOT NULL CHECK (result IN ('attacker_win','attacker_loss')),
  steps integer NOT NULL CHECK (steps BETWEEN 1 AND 900),
  event_log_sha256 text NOT NULL CHECK (event_log_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, request_id)
);
CREATE INDEX battles_player_created ON battles(player_id, created_at DESC);
