ALTER TABLE players ADD COLUMN bootstrap_generation integer NOT NULL DEFAULT 0 CHECK(bootstrap_generation>=0);
