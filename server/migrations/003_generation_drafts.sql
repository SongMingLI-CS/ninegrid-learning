CREATE TABLE IF NOT EXISTS generation_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  input_fingerprint text NOT NULL CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
  input jsonb NOT NULL,
  rules_version integer NOT NULL CHECK (rules_version > 0),
  outline jsonb,
  batches jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('pending','generating','partial','failed','cancelled','awaiting-confirmation','activated')),
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure jsonb,
  final_campaign jsonb,
  activated_season_id uuid REFERENCES seasons(id) ON DELETE SET NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, input_fingerprint)
);
CREATE INDEX IF NOT EXISTS generation_drafts_owner_updated_idx ON generation_drafts (owner_user_id, updated_at DESC);
