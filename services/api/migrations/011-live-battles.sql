-- S18: live state and ordered frames, separate from completed S17 autobattles.
CREATE TABLE live_battles (
 id uuid PRIMARY KEY,
 player_id uuid NOT NULL REFERENCES players(id),
 request_id uuid NOT NULL,
 content_version text NOT NULL REFERENCES content_versions(content_version),
 stage_id text NOT NULL CHECK(stage_id ~ '^[a-z][a-z0-9_]{2,79}$'),
 hero_ids text[] NOT NULL CHECK(cardinality(hero_ids) BETWEEN 1 AND 5),
 session_state jsonb NOT NULL CHECK(jsonb_typeof(session_state)='object'),
 connection_id uuid,
 connected_until timestamptz,
 next_tick_at timestamptz NOT NULL,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(player_id,request_id)
);
CREATE UNIQUE INDEX live_battles_one_active_per_player ON live_battles(player_id) WHERE completed_at IS NULL;
CREATE INDEX live_battles_due ON live_battles(next_tick_at) WHERE completed_at IS NULL;
CREATE TABLE live_battle_frames (
 battle_id uuid NOT NULL REFERENCES live_battles(id),
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 900),
 frame jsonb NOT NULL CHECK(jsonb_typeof(frame)='object'),
 PRIMARY KEY(battle_id,seq)
);
