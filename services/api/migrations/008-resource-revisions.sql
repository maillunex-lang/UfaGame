ALTER TABLE owner_resources ADD COLUMN revision integer NOT NULL DEFAULT 0 CHECK(revision >= 0);
