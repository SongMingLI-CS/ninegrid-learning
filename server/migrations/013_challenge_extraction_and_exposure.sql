ALTER TABLE challenge_runs
  ADD COLUMN IF NOT EXISTS entry_operation_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS challenge_runs_user_entry_operation_idx
  ON challenge_runs(user_id, entry_operation_id)
  WHERE entry_operation_id IS NOT NULL;

ALTER TABLE challenge_runs DROP CONSTRAINT IF EXISTS challenge_runs_status_check;
ALTER TABLE challenge_runs ADD CONSTRAINT challenge_runs_status_check
  CHECK (status IN ('active','evaluating','ready_to_extract','passed','failed','abandoned','technical_error','technical_refund'));

CREATE TABLE IF NOT EXISTS challenge_question_exposures (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id text NOT NULL,
  first_run_id uuid REFERENCES challenge_runs(id) ON DELETE SET NULL,
  exposed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, question_id)
);

INSERT INTO challenge_question_exposures(user_id,question_id,first_run_id,exposed_at)
SELECT c.user_id, question->>'id', c.id, c.started_at
FROM challenge_runs c
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.questions)='array' THEN c.questions ELSE '[]'::jsonb END) AS question
WHERE question ? 'id' AND length(question->>'id') BETWEEN 1 AND 300
ON CONFLICT(user_id,question_id) DO NOTHING;
