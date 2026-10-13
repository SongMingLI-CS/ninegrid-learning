CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  sid varchar PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS user_sessions_expire_idx ON user_sessions (expire);

CREATE TABLE IF NOT EXISTS seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id text NOT NULL,
  title text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, campaign_id)
);
CREATE INDEX IF NOT EXISTS seasons_owner_updated_idx ON seasons (owner_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS wallets (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency text NOT NULL,
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  PRIMARY KEY (user_id, currency)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  definition jsonb NOT NULL,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS reward_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('mission','verification','chain','stage','season','review')),
  idempotency_key text NOT NULL,
  reward jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS reward_ledger_user_time_idx ON reward_ledger (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 4096),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 4096),
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_owner_season_idx ON attachments (owner_user_id, season_id);
