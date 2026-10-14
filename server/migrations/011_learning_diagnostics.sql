CREATE TABLE IF NOT EXISTS learning_diagnostics (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  rules_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('generating','failed','answering','grading','ready','cancelled')),
  input jsonb NOT NULL,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS learning_diagnostics_owner_recent_idx
  ON learning_diagnostics(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS learning_diagnostics_expiry_idx
  ON learning_diagnostics(expires_at);
