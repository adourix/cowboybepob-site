ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

CREATE INDEX IF NOT EXISTS customers_email_verified_idx
  ON customers(email_verified_at);

CREATE INDEX IF NOT EXISTS auth_tokens_lookup_idx
  ON auth_tokens(principal_type, principal_id, purpose, expires_at)
  WHERE used_at IS NULL;
