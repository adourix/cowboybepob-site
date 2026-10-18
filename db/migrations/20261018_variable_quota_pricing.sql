ALTER TABLE config_plans
  ADD COLUMN IF NOT EXISTS quota_pricing_mode text NOT NULL DEFAULT 'FIXED',
  ADD COLUMN IF NOT EXISTS quota_price_per_gb_minor bigint,
  ADD COLUMN IF NOT EXISTS min_quota_gb integer,
  ADD COLUMN IF NOT EXISTS max_quota_gb integer,
  ADD COLUMN IF NOT EXISTS quota_step_gb integer NOT NULL DEFAULT 1;

ALTER TABLE config_plans DROP CONSTRAINT IF EXISTS config_plans_quota_pricing_mode_check;
ALTER TABLE config_plans ADD CONSTRAINT config_plans_quota_pricing_mode_check CHECK (quota_pricing_mode IN ('FIXED','PER_GB'));
ALTER TABLE config_plans DROP CONSTRAINT IF EXISTS config_plans_quota_price_per_gb_check;
ALTER TABLE config_plans ADD CONSTRAINT config_plans_quota_price_per_gb_check CHECK (quota_price_per_gb_minor IS NULL OR quota_price_per_gb_minor > 0);
ALTER TABLE config_plans DROP CONSTRAINT IF EXISTS config_plans_min_quota_gb_check;
ALTER TABLE config_plans ADD CONSTRAINT config_plans_min_quota_gb_check CHECK (min_quota_gb IS NULL OR min_quota_gb > 0);
ALTER TABLE config_plans DROP CONSTRAINT IF EXISTS config_plans_max_quota_gb_check;
ALTER TABLE config_plans ADD CONSTRAINT config_plans_max_quota_gb_check CHECK (max_quota_gb IS NULL OR max_quota_gb >= COALESCE(min_quota_gb,1));
ALTER TABLE config_plans DROP CONSTRAINT IF EXISTS config_plans_quota_step_gb_check;
ALTER TABLE config_plans ADD CONSTRAINT config_plans_quota_step_gb_check CHECK (quota_step_gb > 0);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS quota_bytes bigint;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS quota_gb integer;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_quota_gb_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_quota_gb_check CHECK (quota_gb IS NULL OR quota_gb > 0);
