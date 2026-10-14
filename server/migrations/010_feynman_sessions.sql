CREATE TABLE IF NOT EXISTS feynman_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  lesson_revision integer NOT NULL CHECK (lesson_revision > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('active','ready','settled','assisted')),
  transcript jsonb NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, season_id, task_id, id)
);
CREATE INDEX IF NOT EXISTS feynman_sessions_owner_recent_idx
  ON feynman_sessions(user_id, season_id, task_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS feynman_sessions_expiry_idx ON feynman_sessions(expires_at);
