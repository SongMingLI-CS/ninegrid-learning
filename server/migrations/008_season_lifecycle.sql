ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active','paused','archived'));
ALTER TABLE inventory_item_preferences
  ADD COLUMN IF NOT EXISTS showcase_order smallint NOT NULL DEFAULT 0
    CHECK (showcase_order BETWEEN 0 AND 3);

CREATE TABLE IF NOT EXISTS user_current_seasons (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE RESTRICT,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO user_current_seasons(user_id,season_id)
SELECT DISTINCT ON (owner_user_id) owner_user_id,id
FROM seasons
WHERE lifecycle_status <> 'archived'
ORDER BY owner_user_id, updated_at DESC
ON CONFLICT (user_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS seasons_owner_status_updated_idx
  ON seasons(owner_user_id,lifecycle_status,updated_at DESC);
