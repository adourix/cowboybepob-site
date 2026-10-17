BEGIN;

-- subscription_periods.order_item_id is nullable, so the old partial unique
-- index did not match `ON CONFLICT (order_item_id)` in renew_service.
-- A normal UNIQUE index has the same uniqueness semantics for nullable values
-- (multiple NULLs are still allowed) and is a valid ON CONFLICT arbiter.
DROP INDEX IF EXISTS subscription_periods_item_uq;
CREATE UNIQUE INDEX subscription_periods_item_uq
  ON subscription_periods(order_item_id);

-- Requeue renewals that were exhausted only because PostgreSQL rejected the
-- ON CONFLICT target. Other failures are intentionally left untouched.
UPDATE jobs
SET state='QUEUED',
    attempts=0,
    run_at=now(),
    locked_at=NULL,
    locked_by=NULL,
    last_error=NULL,
    updated_at=now()
WHERE type='renew_service'
  AND state='NEEDS_ATTENTION'
  AND last_error ILIKE '%there is no unique or exclusion constraint matching the ON CONFLICT specification%';

UPDATE order_items oi
SET fulfillment_status='IN_PROGRESS',
    fulfillment_detail=NULL
WHERE oi.id IN (
  SELECT j.subject_id
  FROM jobs j
  WHERE j.type='renew_service'
    AND j.state='QUEUED'
    AND j.last_error IS NULL
);

COMMIT;
