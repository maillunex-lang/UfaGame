-- Drafts are independent of published content and cannot activate it.
CREATE TABLE studio_drafts (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
