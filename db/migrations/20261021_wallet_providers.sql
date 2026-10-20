-- Orange Cash support: manual wallet transfers share one provider name; SMS remember their carrier.
-- Additive and idempotent.
BEGIN;
UPDATE payments SET provider = 'MANUAL_WALLET' WHERE provider = 'MANUAL_VODAFONE_CASH';
ALTER TABLE payment_sms ADD COLUMN IF NOT EXISTS carrier text;
UPDATE payment_sms SET carrier = 'VODAFONE' WHERE carrier IS NULL AND parse_status = 'PARSED';
COMMIT;
