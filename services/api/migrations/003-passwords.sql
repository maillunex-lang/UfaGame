ALTER TABLE players ADD COLUMN login text UNIQUE CHECK(login ~ '^[a-z0-9_]{3,32}$');
ALTER TABLE players ADD COLUMN password_hash text;
ALTER TABLE players ADD COLUMN recovery_hash text;
ALTER TABLE players ADD CONSTRAINT account_credentials CHECK(
 (account_type='guest' AND login IS NULL AND password_hash IS NULL AND recovery_hash IS NULL) OR
 (account_type='registered' AND login IS NOT NULL AND password_hash IS NOT NULL AND recovery_hash IS NOT NULL)
);
