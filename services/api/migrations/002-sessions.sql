ALTER TABLE players ADD COLUMN bootstrap_hash text UNIQUE;
ALTER TABLE players ADD COLUMN bootstrap_disabled boolean NOT NULL DEFAULT false;
CREATE TABLE sessions (
 id uuid PRIMARY KEY, player_id uuid NOT NULL REFERENCES players(id),
 access_hash text NOT NULL UNIQUE, refresh_hash text NOT NULL UNIQUE,
 access_expires_at timestamptz NOT NULL, refresh_expires_at timestamptz NOT NULL,
 revoked_at timestamptz, previous_refresh_hash text, previous_request_id uuid, retry_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_player ON sessions(player_id);
CREATE INDEX sessions_previous ON sessions(previous_refresh_hash);
ALTER TABLE players ADD COLUMN initial_session_id uuid REFERENCES sessions(id);
