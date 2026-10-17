BEGIN;

CREATE OR REPLACE FUNCTION cb_normalize_marzban_username(input text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE value text; hash_suffix text;
BEGIN
  value := lower(coalesce(input, ''));
  value := regexp_replace(value, '[^a-z0-9]+', '_', 'g');
  value := regexp_replace(value, '^_+|_+$', '', 'g');
  IF value = '' THEN value := 'user'; END IF;
  IF value !~ '^cb_[a-z0-9]+(_[a-z0-9]+)*$' THEN value := 'cb_' || value; END IF;
  IF length(value) > 32 THEN
    hash_suffix := substr(md5(coalesce(input, '')), 1, 7);
    value := substr(value, 1, 24) || '_' || hash_suffix;
  END IF;
  IF length(value) < 3 THEN value := rpad(value, 3, '0'); END IF;
  RETURN value;
END;
$$;

UPDATE proxy_accounts
SET external_username = cb_normalize_marzban_username(external_username), updated_at = now()
WHERE external_username !~ '^[a-z0-9]+(_[a-z0-9]+)*$'
   OR length(external_username) NOT BETWEEN 3 AND 32;

CREATE OR REPLACE FUNCTION cb_normalize_proxy_account_username()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.external_username := cb_normalize_marzban_username(NEW.external_username);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_proxy_account_username_guard ON proxy_accounts;
CREATE TRIGGER cb_proxy_account_username_guard
BEFORE INSERT OR UPDATE OF external_username ON proxy_accounts
FOR EACH ROW EXECUTE FUNCTION cb_normalize_proxy_account_username();

CREATE TEMP TABLE cb_username_repair_targets ON COMMIT DROP AS
SELECT DISTINCT sa.id allocation_id, sa.service_id, sa.endpoint_id, s.origin_order_item_id
FROM service_allocations sa
JOIN services s ON s.id = sa.service_id
WHERE sa.status = 'FAILED'
  AND sa.failed_reason LIKE 'Marzban 422:%Username only can%'
  AND s.status = 'FAILED';

UPDATE service_allocations sa
SET status='RESERVED', failed_reason=NULL, retired_at=NULL
FROM cb_username_repair_targets r WHERE sa.id=r.allocation_id;

UPDATE services s SET status='PROVISIONING', updated_at=now()
FROM cb_username_repair_targets r WHERE s.id=r.service_id;

-- The failed provider 4xx path released this allocation's capacity. Re-reserve it for retry.
UPDATE server_endpoints e
SET allocated_count=e.allocated_count+1, updated_at=now()
FROM cb_username_repair_targets r WHERE e.id=r.endpoint_id;

UPDATE order_items oi
SET fulfillment_status='IN_PROGRESS', fulfillment_detail=NULL, result_service_id=r.service_id
FROM cb_username_repair_targets r WHERE oi.id=r.origin_order_item_id;

INSERT INTO jobs(type,key,subject_type,subject_id,payload)
SELECT 'provision_service','provision:'||r.service_id,'SERVICE',r.service_id,
       jsonb_build_object('serviceId',r.service_id,'reason','MARZBAN_USERNAME_REPAIR')
FROM cb_username_repair_targets r
ON CONFLICT(key) DO UPDATE
SET state=CASE WHEN jobs.state IN ('SUCCEEDED','NEEDS_ATTENTION') THEN 'QUEUED' ELSE jobs.state END,
    run_at=CASE WHEN jobs.state IN ('SUCCEEDED','NEEDS_ATTENTION') THEN now() ELSE jobs.run_at END,
    last_error=CASE WHEN jobs.state IN ('SUCCEEDED','NEEDS_ATTENTION') THEN NULL ELSE jobs.last_error END,
    updated_at=now();

COMMIT;
