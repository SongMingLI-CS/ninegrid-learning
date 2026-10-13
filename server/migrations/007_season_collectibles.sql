CREATE TABLE IF NOT EXISTS season_collectibles (
  season_id uuid PRIMARY KEY REFERENCES seasons(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  reward_key text NOT NULL CHECK (reward_key ~ '^[a-f0-9]{64}$'),
  definition jsonb NOT NULL,
  final_task_id text NOT NULL,
  gate_task_ids text[] NOT NULL CHECK (cardinality(gate_task_ids) > 0),
  reward_version integer NOT NULL DEFAULT 1 CHECK (reward_version = 1),
  claimed_at timestamptz,
  evidence_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, season_id)
);
CREATE INDEX IF NOT EXISTS season_collectibles_owner_idx ON season_collectibles(owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS season_collectible_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  reward_key text NOT NULL CHECK (reward_key ~ '^[a-f0-9]{64}$'),
  item_id text NOT NULL,
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  reward_version integer NOT NULL DEFAULT 1 CHECK (reward_version = 1),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, reward_key),
  UNIQUE(owner_user_id, season_id)
);
CREATE INDEX IF NOT EXISTS season_collectible_claims_owner_idx ON season_collectible_claims(owner_user_id, claimed_at DESC);

DO $source_constraint$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_acquisitions_source_type_check') THEN
    ALTER TABLE inventory_acquisitions DROP CONSTRAINT inventory_acquisitions_source_type_check;
  END IF;
  ALTER TABLE inventory_acquisitions ADD CONSTRAINT inventory_acquisitions_source_type_check
    CHECK (source_type IN ('learning','purchase','box-open','challenge','migration','season-exclusive'));
END;
$source_constraint$;
