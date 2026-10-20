-- Payments v2: provider abstraction (Vodafone Cash manual + Kashier), Android SMS devices,
-- SMS matching, accountant review window, payment audit trail.
-- Additive and idempotent. Run once on deploy; safe to re-run.
BEGIN;

-- ── payments: common columns used by every provider
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS provider_reference text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS customer_wallet text,
  ADD COLUMN IF NOT EXISTS receiving_wallet text,
  ADD COLUMN IF NOT EXISTS screenshot_path text,
  ADD COLUMN IF NOT EXISTS screenshot_mime text,
  ADD COLUMN IF NOT EXISTS screenshot_sha256 text,
  ADD COLUMN IF NOT EXISTS proof_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS match_details jsonb,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS provisional_activation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS webhook_status text,
  ADD COLUMN IF NOT EXISTS webhook_received_at timestamptz;

-- Legacy rows → new common states (SUCCEEDED was the old "paid").
UPDATE payments SET provider = COALESCE(provider, CASE WHEN gateway = 'manual' THEN 'MANUAL_VODAFONE_CASH' ELSE upper(gateway) END) WHERE provider IS NULL;
UPDATE payments SET status = 'PAID', verified_at = COALESCE(verified_at, paid_at) WHERE status = 'SUCCEEDED';
UPDATE payments SET status = 'PENDING_VERIFICATION' WHERE status IN ('INITIATED', 'PENDING') AND provider = 'MANUAL_VODAFONE_CASH';
UPDATE payments SET method = 'VODAFONE_CASH' WHERE provider = 'MANUAL_VODAFONE_CASH' AND (method IS NULL OR method IN ('pending', 'manual', 'bank_transfer', 'WALLET_TRANSFER', 'INSTAPAY_TRANSFER'));

CREATE INDEX IF NOT EXISTS payments_status_idx ON payments(status, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments(order_id, created_at DESC);
-- One open attempt per order at a time (duplicate payment protection).
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_open_per_order_uq ON payments(order_id)
  WHERE status IN ('AWAITING_TRANSFER', 'PENDING_VERIFICATION', 'CREATED', 'CHECKOUT_STARTED', 'PROCESSING');
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_payment_uq ON payments(provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;

-- ── orders only know method / status / payment id (no provider logic)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES payments(id);

-- ── Android devices that forward Vodafone Cash SMS
CREATE TABLE IF NOT EXISTS payment_devices(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_key text UNIQUE NOT NULL,
  name text NOT NULL,
  device_token_hash bytea UNIQUE NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  last_sms_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── every SMS received (raw kept for accountants only)
CREATE TABLE IF NOT EXISTS payment_sms(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid REFERENCES payments(id),
  device_id uuid REFERENCES payment_devices(id),
  raw_message text NOT NULL,
  message_hash text UNIQUE NOT NULL,
  parse_status text NOT NULL,
  parse_error text,
  parsed_amount_minor bigint,
  parsed_sender_wallet text,
  parsed_sender_name text,
  parsed_receiver_wallet text,
  parsed_transaction_reference text,
  parsed_transaction_time timestamptz,
  parsed_balance_minor bigint,
  match_status text NOT NULL DEFAULT 'UNMATCHED',
  match_details jsonb,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_sms_reference_uq ON payment_sms(parsed_transaction_reference)
  WHERE parsed_transaction_reference IS NOT NULL AND match_status <> 'DUPLICATE';
CREATE INDEX IF NOT EXISTS payment_sms_unmatched_idx ON payment_sms(match_status, parsed_transaction_time);

-- ── provider webhooks: idempotency (gateway,event_id) already unique on payment_events.

-- ── payment state audit trail
CREATE TABLE IF NOT EXISTS payment_audit_logs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id),
  actor_type text NOT NULL,
  actor_id uuid,
  previous_status text,
  new_status text NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_audit_logs_payment_idx ON payment_audit_logs(payment_id, created_at);

-- ── catalog soft delete: archived rows stay for order history but disappear from lists
CREATE INDEX IF NOT EXISTS config_plans_status_idx ON config_plans(status);

COMMIT;
