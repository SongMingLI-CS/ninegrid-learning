CREATE TABLE IF NOT EXISTS inventory_item_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  is_locked boolean NOT NULL DEFAULT false,
  is_showcased boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS inventory_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  items jsonb NOT NULL,
  coins bigint NOT NULL CHECK (coins > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, operation_id)
);
CREATE INDEX IF NOT EXISTS inventory_sales_user_time_idx ON inventory_sales(user_id, created_at DESC);
