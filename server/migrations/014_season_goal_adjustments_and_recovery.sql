ALTER TABLE seasons
  DROP CONSTRAINT IF EXISTS seasons_lifecycle_status_check;

ALTER TABLE seasons
  ADD CONSTRAINT seasons_lifecycle_status_check
    CHECK (lifecycle_status IN ('active','paused','archived','deleted'));

CREATE TABLE IF NOT EXISTS season_goal_adjustments (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE RESTRICT,
  revision_before integer NOT NULL CHECK (revision_before > 0),
  revision_after integer NOT NULL CHECK (revision_after = revision_before + 1),
  previous_goal text NOT NULL,
  next_goal text NOT NULL,
  previous_artifact text NOT NULL,
  next_artifact text NOT NULL,
  preview jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS season_goal_adjustments_owner_season_idx
  ON season_goal_adjustments(owner_user_id, season_id, created_at DESC);
