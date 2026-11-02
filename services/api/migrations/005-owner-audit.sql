CREATE TABLE owner_accounts (
 id smallint PRIMARY KEY CHECK(id=1), login text NOT NULL UNIQUE CHECK(login ~ '^[a-z0-9_]{3,32}$'),
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 80),
 password_hash text NOT NULL, revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 credential_version integer NOT NULL DEFAULT 1 CHECK(credential_version>=1),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE owner_sessions (
 id uuid PRIMARY KEY, owner_id smallint NOT NULL REFERENCES owner_accounts(id),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX owner_sessions_active ON owner_sessions(owner_id,expires_at) WHERE revoked_at IS NULL;
CREATE TABLE owner_audit (
 sequence bigserial PRIMARY KEY, id uuid NOT NULL UNIQUE, owner_id smallint NOT NULL REFERENCES owner_accounts(id),
 action text NOT NULL, resource_id text NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 300),
 request_id uuid NOT NULL, fingerprint text NOT NULL,
 before_state jsonb, after_state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,request_id)
);
CREATE FUNCTION reject_owner_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'owner_audit is append-only' USING ERRCODE='42501'; END $$;
CREATE TRIGGER owner_audit_immutable BEFORE UPDATE OR DELETE ON owner_audit FOR EACH ROW EXECUTE FUNCTION reject_owner_audit_change();
CREATE TRIGGER owner_audit_no_truncate BEFORE TRUNCATE ON owner_audit FOR EACH STATEMENT EXECUTE FUNCTION reject_owner_audit_change();
