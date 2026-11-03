-- Private owner assets. This migration does not publish content.
CREATE TABLE owner_resources (
 id text PRIMARY KEY CHECK(id ~ '^[a-z][a-z0-9_]{2,79}$'),
 descriptor jsonb NOT NULL CHECK(jsonb_typeof(descriptor)='object'),
 payload bytea NOT NULL CHECK(octet_length(payload) BETWEEN 1 AND 8388608),
 created_at timestamptz NOT NULL DEFAULT now()
);
