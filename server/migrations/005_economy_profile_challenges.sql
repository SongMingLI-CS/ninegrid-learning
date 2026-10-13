CREATE TABLE IF NOT EXISTS economy_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('purchase','open')),
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  pool_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, operation_id)
);
ALTER TABLE inventory_sales ADD COLUMN IF NOT EXISTS request_hash text;
CREATE INDEX IF NOT EXISTS economy_operations_user_time_idx ON economy_operations(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS inventory_acquisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  source_type text NOT NULL CHECK (source_type IN ('learning','purchase','box-open','challenge')),
  source_id text NOT NULL,
  season_id uuid REFERENCES seasons(id) ON DELETE SET NULL,
  task_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_acquisitions_user_item_idx ON inventory_acquisitions(user_id,item_id,created_at DESC);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nickname text NOT NULL DEFAULT '行动者' CHECK (char_length(nickname) BETWEEN 1 AND 32),
  avatar_url text NOT NULL DEFAULT '' CHECK (char_length(avatar_url) <= 500),
  bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 240),
  is_public boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS challenge_runs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('ordinary','confidential','top-secret')),
  status text NOT NULL CHECK (status IN ('active','evaluating','passed','failed','abandoned','technical_error','technical_refund')),
  entry_fee integer NOT NULL CHECK (entry_fee > 0),
  prompt text NOT NULL,
  evidence text,
  evaluation jsonb,
  submitted_at timestamptz,
  reward_item jsonb,
  draw_audit jsonb,
  pool_version text NOT NULL DEFAULT '2026-10-v1',
  reward_coins integer NOT NULL DEFAULT 0 CHECK (reward_coins >= 0),
  refund_operation_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS challenge_runs_user_time_idx ON challenge_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS challenge_runs_daily_idx ON challenge_runs(user_id, tier, started_at DESC);
