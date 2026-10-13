-- Hafver currency redenomination from the v1 demonstration scale to integer v2.
-- Old wallet amounts are multiplied 10,000:1. Existing safes are redeemed 1:1
-- as same-type safes; owned collections and all historical amounts stay intact.
DO $constraint$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallets_balance_safe_integer') THEN
    ALTER TABLE wallets ADD CONSTRAINT wallets_balance_safe_integer CHECK (balance <= 9007199254740991);
  END IF;
END;
$constraint$;

ALTER TABLE reward_ledger ADD COLUMN IF NOT EXISTS economy_version text NOT NULL DEFAULT '2026-10-v1';
ALTER TABLE inventory_sales ADD COLUMN IF NOT EXISTS economy_version text NOT NULL DEFAULT '2026-10-v1';
DO $sale_constraint$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_sales_coins_safe_integer') THEN
    ALTER TABLE inventory_sales ADD CONSTRAINT inventory_sales_coins_safe_integer CHECK (coins <= 9007199254740991);
  END IF;
END;
$sale_constraint$;
ALTER TABLE economy_operations ALTER COLUMN pool_version SET DEFAULT '2026-10-v2';

CREATE TABLE IF NOT EXISTS economy_migrations (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version text NOT NULL,
  currency_ratio bigint NOT NULL CHECK (currency_ratio > 0),
  old_balance bigint NOT NULL CHECK (old_balance >= 0),
  new_balance bigint NOT NULL CHECK (new_balance >= 0),
  safe_entitlements jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, version)
);

DO $source_constraint$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_acquisitions_source_type_check') THEN
    ALTER TABLE inventory_acquisitions DROP CONSTRAINT inventory_acquisitions_source_type_check;
  END IF;
  ALTER TABLE inventory_acquisitions ADD CONSTRAINT inventory_acquisitions_source_type_check
    CHECK (source_type IN ('learning','purchase','box-open','challenge','migration'));
END;
$source_constraint$;

DO $redenom$
DECLARE
  account record;
  old_balance bigint;
  new_balance numeric;
  small_count integer;
  large_count integer;
  small_definition jsonb;
  large_definition jsonb;
BEGIN
  FOR account IN SELECT id FROM users ORDER BY id LOOP
    PERFORM 1 FROM users WHERE id = account.id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM economy_migrations WHERE user_id = account.id AND version = '2026-10-v2') THEN
      CONTINUE;
    END IF;

    SELECT balance INTO old_balance FROM wallets
      WHERE user_id = account.id AND currency = 'learning-coin' FOR UPDATE;
    old_balance := COALESCE(old_balance, 0);
    new_balance := old_balance::numeric * 10000;
    IF new_balance > 9007199254740991 THEN
      RAISE EXCEPTION 'Wallet balance for user % exceeds safe v2 conversion limit', account.id;
    END IF;

    small_count := 0; large_count := 0;
    SELECT quantity, definition INTO small_count, small_definition FROM inventory_items
      WHERE user_id = account.id AND item_id = 'box-small-safe-2026-10-v1' FOR UPDATE;
    small_count := COALESCE(small_count, 0);
    SELECT quantity, definition INTO large_count, large_definition FROM inventory_items
      WHERE user_id = account.id AND item_id = 'box-large-safe-2026-10-v1' FOR UPDATE;
    large_count := COALESCE(large_count, 0);

    IF small_count > 0 THEN
      INSERT INTO inventory_items(user_id,item_id,definition,quantity)
      VALUES(account.id,'box-small-safe-2026-10-v2',
        COALESCE(small_definition, jsonb_build_object('id','box-small-safe-2026-10-v2','itemId','box-small-safe-2026-10-v2','name','小保险','description','旧版本保险箱权益迁移。','rarity','common','icon','▣','quantity',small_count)) || jsonb_build_object('id','box-small-safe-2026-10-v2','itemId','box-small-safe-2026-10-v2','quantity',small_count),small_count)
      ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=inventory_items.quantity+EXCLUDED.quantity;
      UPDATE inventory_items SET quantity=0 WHERE user_id=account.id AND item_id='box-small-safe-2026-10-v1';
      INSERT INTO inventory_acquisitions(user_id,item_id,quantity,source_type,source_id)
        VALUES(account.id,'box-small-safe-2026-10-v2',small_count,'migration','2026-10-v2:box-entitlement');
    END IF;
    IF large_count > 0 THEN
      INSERT INTO inventory_items(user_id,item_id,definition,quantity)
      VALUES(account.id,'box-large-safe-2026-10-v2',
        COALESCE(large_definition, jsonb_build_object('id','box-large-safe-2026-10-v2','itemId','box-large-safe-2026-10-v2','name','大保险','description','旧版本保险箱权益迁移。','rarity','common','icon','▣','quantity',large_count)) || jsonb_build_object('id','box-large-safe-2026-10-v2','itemId','box-large-safe-2026-10-v2','quantity',large_count),large_count)
      ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=inventory_items.quantity+EXCLUDED.quantity;
      UPDATE inventory_items SET quantity=0 WHERE user_id=account.id AND item_id='box-large-safe-2026-10-v1';
      INSERT INTO inventory_acquisitions(user_id,item_id,quantity,source_type,source_id)
        VALUES(account.id,'box-large-safe-2026-10-v2',large_count,'migration','2026-10-v2:box-entitlement');
    END IF;

    IF old_balance > 0 THEN
      UPDATE wallets SET balance = new_balance::bigint
        WHERE user_id = account.id AND currency = 'learning-coin';
    END IF;
    INSERT INTO economy_migrations(user_id,version,currency_ratio,old_balance,new_balance,safe_entitlements)
    VALUES(account.id,'2026-10-v2',10000,old_balance,new_balance::bigint,
      jsonb_build_object('small-safe',small_count,'large-safe',large_count,'safeConversionRatio','1:1'));
  END LOOP;
END;
$redenom$;
