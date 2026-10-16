ALTER TABLE challenge_runs DROP CONSTRAINT IF EXISTS challenge_runs_tier_check;
ALTER TABLE challenge_runs ADD CONSTRAINT challenge_runs_tier_check
  CHECK (tier IN ('free','ordinary','confidential','top-secret'));

ALTER TABLE challenge_runs DROP CONSTRAINT IF EXISTS challenge_runs_entry_fee_check;
ALTER TABLE challenge_runs ADD CONSTRAINT challenge_runs_entry_fee_check CHECK (entry_fee >= 0);

ALTER TABLE challenge_runs
  ADD COLUMN IF NOT EXISTS question_count integer NOT NULL DEFAULT 1 CHECK (question_count BETWEEN 1 AND 15),
  ADD COLUMN IF NOT EXISTS pass_threshold integer NOT NULL DEFAULT 1 CHECK (pass_threshold BETWEEN 1 AND 15),
  ADD COLUMN IF NOT EXISTS questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS correct_answers integer NOT NULL DEFAULT 0 CHECK (correct_answers >= 0),
  ADD COLUMN IF NOT EXISTS question_set_version text NOT NULL DEFAULT 'legacy-single-question';

ALTER TABLE challenge_runs ADD CONSTRAINT challenge_runs_tier_fee_check
  CHECK ((tier = 'free' AND entry_fee = 0) OR (tier <> 'free' AND entry_fee > 0));

-- Preserve historical successful single-question runs in the new K/D numerator.
UPDATE challenge_runs
SET correct_answers = 1
WHERE tier IN ('ordinary','confidential','top-secret')
  AND status = 'passed'
  AND evaluation IS NOT NULL
  AND correct_answers = 0;

CREATE INDEX IF NOT EXISTS challenge_runs_user_tier_settled_idx
  ON challenge_runs(user_id, tier, settled_at DESC)
  WHERE status IN ('passed','failed','abandoned');
