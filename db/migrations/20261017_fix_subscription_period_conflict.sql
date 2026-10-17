BEGIN;

-- subscription_periods.order_item_id is nullable, so the old partial unique
-- index did not match `ON CONFLICT (order_item_id)` in renew_service.
-- A normal UNIQUE index has the same uniqueness semantics for nullable values
-- (multiple NULLs are still allowed) and is a valid ON CONFLICT arbiter.
DROP INDEX IF EXISTS subscription_periods_item_uq;
CREATE UNIQUE INDEX subscription_periods_item_uq
  ON subscription_periods(order_item_id);

-- Requeue only renewals that were exhausted because PostgreSQL rejected the
-- ON CONFLICT target. Other NEEDS_ATTENTION jobs are left untouched.
CREATE TEMP TABLE cb_renewal_repair_targets ON COMMIT DROP AS
SELECT id, subject_id
FROM jobs
WHERE type='renew_service'
  AND state='NEEDS_ATTENTION'
  AND last_error ILIKE '%there is no unique or exclusion constraint matching the ON CONFLICT specification%';

UPDATE jobs j
SET state='QUEUED',
    attempts=0,
    run_at=now(),
    locked_at=NULL,
    locked_by=NULL,
    last_error=NULL,
    updated_at=now()
FROM cb_renewal_repair_targets r
WHERE j.id=r.id;

UPDATE order_items oi
SET fulfillment_status='IN_PROGRESS',
    fulfillment_detail=NULL
FROM cb_renewal_repair_targets r
WHERE oi.id=r.subject_id;

COMMIT;
