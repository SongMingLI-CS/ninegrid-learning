ALTER TABLE reward_ledger DROP CONSTRAINT IF EXISTS reward_ledger_kind_check;
ALTER TABLE reward_ledger ADD CONSTRAINT reward_ledger_kind_check
  CHECK (kind IN ('mission','verification','chain','stage','season','review','challenge'));
