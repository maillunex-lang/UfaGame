CREATE TABLE players (
 id uuid PRIMARY KEY,
 account_type text NOT NULL DEFAULT 'guest' CHECK(account_type IN ('guest','registered')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE balances (
 player_id uuid NOT NULL REFERENCES players(id), currency text NOT NULL CHECK(currency ~ '^[a-z][a-z0-9_]{2,79}$'),
 amount bigint NOT NULL DEFAULT 0 CHECK(amount BETWEEN 0 AND 2147483647),
 PRIMARY KEY(player_id,currency)
);
CREATE TABLE ledger (
 id uuid PRIMARY KEY, player_id uuid NOT NULL REFERENCES players(id), currency text NOT NULL,
 delta bigint NOT NULL CHECK(delta BETWEEN -2147483647 AND 2147483647 AND delta<>0),
 balance bigint NOT NULL CHECK(balance BETWEEN 0 AND 2147483647), reason text NOT NULL,
 source_id text NOT NULL, idempotency_key text NOT NULL, fingerprint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(player_id,idempotency_key)
);
CREATE TABLE jobs (
 id uuid PRIMARY KEY, dedupe_key text NOT NULL UNIQUE, kind text NOT NULL CHECK(kind='ledger_delta'),
 payload jsonb NOT NULL, fingerprint text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','running','succeeded','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 run_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_token uuid, worker_id text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_claim ON jobs(status,run_at,lease_until);
