ALTER TABLE services ADD COLUMN IF NOT EXISTS provisioning_mode text NOT NULL DEFAULT 'MANAGED';
ALTER TABLE configs ADD COLUMN IF NOT EXISTS manual_link_enc bytea;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='services_provisioning_mode_check') THEN ALTER TABLE services ADD CONSTRAINT services_provisioning_mode_check CHECK (provisioning_mode IN ('MANAGED','MANUAL')); END IF; END $$;
CREATE INDEX IF NOT EXISTS services_provisioning_mode_idx ON services(provisioning_mode);
