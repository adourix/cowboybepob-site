-- Provider credentials belong to each Marzban provider instance, not the application .env.
-- The application encrypts/decrypts this JSON using ENCRYPTION_KEY before use.
ALTER TABLE provider_instances
  ADD COLUMN IF NOT EXISTS credentials_enc bytea;

CREATE INDEX IF NOT EXISTS provider_instances_status_idx
  ON provider_instances(status);
