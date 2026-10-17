CREATE TABLE IF NOT EXISTS season_goal_adjustment_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  goal text NOT NULL,
  desired_artifact text NOT NULL,
  status text NOT NULL DEFAULT 'editing'
    CHECK (status IN ('editing', 'generating', 'preview-ready', 'failed', 'interrupted', 'applied')),
  progress_step text NOT NULL DEFAULT 'saved'
    CHECK (progress_step IN ('saved', 'assessment', 'validation', 'review', 'complete')),
  preview_id text UNIQUE,
  preview jsonb,
  error_code text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, season_id)
);

CREATE INDEX IF NOT EXISTS season_goal_adjustment_drafts_status_idx
  ON season_goal_adjustment_drafts (status, updated_at);
