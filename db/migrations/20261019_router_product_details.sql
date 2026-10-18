-- Router shop details shown on /customer/routers (brand, photo, spec sheet, "recommended" badge).
-- Additive and idempotent: safe to run more than once.
BEGIN;
ALTER TABLE router_products
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS specs jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
COMMIT;
