-- S23/S24/S28 (ADR 0021): the player's hero and item instances. Content defines
-- heroes/items/costs; these rows only say what the player owns and how it is grown.
-- Every grant has a per-player source_key, so a repeated reward or starter grant
-- is a no-op. Spending is checked against the expected state under a row lock.
CREATE TABLE player_heroes (
  id uuid PRIMARY KEY,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  player_id uuid NOT NULL REFERENCES players(id),
  hero_id text NOT NULL CHECK (hero_id ~ '^[a-z][a-z0-9_]{2,79}$'),
  level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 500),
  rank integer NOT NULL DEFAULT 0 CHECK (rank BETWEEN 0 AND 19),
  protected boolean NOT NULL DEFAULT false,
  source_key text NOT NULL CHECK (length(source_key) BETWEEN 1 AND 200),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, source_key),
  UNIQUE (id, player_id)
);
CREATE INDEX player_heroes_owner ON player_heroes(player_id) WHERE consumed_at IS NULL;

-- Five main heroes and sync slots; one instance holds at most one place.
CREATE TABLE player_team (
  player_id uuid NOT NULL REFERENCES players(id),
  role text NOT NULL CHECK (role IN ('main','sync')),
  slot integer NOT NULL CHECK (slot BETWEEN 0 AND 19 AND (role='sync' OR slot<5)),
  instance_id uuid NOT NULL,
  PRIMARY KEY (player_id, role, slot),
  UNIQUE (instance_id),
  FOREIGN KEY (instance_id, player_id) REFERENCES player_heroes(id, player_id)
);

CREATE TABLE player_items (
  id uuid PRIMARY KEY,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  player_id uuid NOT NULL REFERENCES players(id),
  item_id text NOT NULL CHECK (item_id ~ '^[a-z][a-z0-9_]{2,79}$'),
  slot text NOT NULL CHECK (slot IN ('weapon','armor','helmet','boots','jewelry','artifact')),
  upgrade integer NOT NULL DEFAULT 0 CHECK (upgrade BETWEEN 0 AND 50),
  equipped_on uuid,
  source_key text NOT NULL CHECK (length(source_key) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, source_key),
  FOREIGN KEY (equipped_on, player_id) REFERENCES player_heroes(id, player_id)
);
-- One item per slot per hero; an item row is on at most one hero by construction.
CREATE UNIQUE INDEX player_items_one_per_slot ON player_items(equipped_on, slot) WHERE equipped_on IS NOT NULL;

-- Battles pin the instances and the stats modifiers used at start.
ALTER TABLE live_battles ADD COLUMN instance_ids uuid[], ADD COLUMN attacker_mods jsonb;
ALTER TABLE battles ADD COLUMN instance_ids uuid[], ADD COLUMN attacker_mods jsonb;
