BEGIN;

-- Repair only unfinished CONFIG_RENEWAL items.
-- Their old period may have been created using current_period_end instead of NOW().
WITH repaired AS (
  SELECT
    sp.id,
    now() AS new_start,
    now() + make_interval(days => p.duration_days) AS new_end,
    p.quota_bytes AS new_quota
  FROM subscription_periods sp
  JOIN order_items oi ON oi.id = sp.order_item_id
  JOIN config_plans p ON p.id = oi.plan_id
  WHERE oi.item_type = 'CONFIG_RENEWAL'
    AND oi.fulfillment_status <> 'FULFILLED'
  FOR UPDATE OF sp
)
UPDATE subscription_periods sp
SET starts_at = r.new_start,
    ends_at = r.new_end,
    quota_bytes = r.new_quota
FROM repaired r
WHERE sp.id = r.id;

UPDATE subscriptions sub
SET current_period_end = sp.ends_at,
    quota_bytes = sp.quota_bytes,
    used_bytes = 0,
    status = 'ACTIVE',
    grace_until = NULL,
    updated_at = now()
FROM subscription_periods sp
JOIN order_items oi ON oi.id = sp.order_item_id
WHERE sp.subscription_id = sub.id
  AND oi.item_type = 'CONFIG_RENEWAL'
  AND oi.fulfillment_status <> 'FULFILLED';

UPDATE order_items oi
SET fulfillment_status = 'IN_PROGRESS',
    fulfillment_detail = NULL
WHERE oi.item_type = 'CONFIG_RENEWAL'
  AND oi.fulfillment_status IN ('NEEDS_ATTENTION', 'PENDING');

UPDATE jobs j
SET state = 'QUEUED',
    attempts = 0,
    run_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    last_error = NULL,
    updated_at = now()
WHERE j.type = 'renew_service'
  AND j.subject_id IN (
    SELECT oi.id
    FROM order_items oi
    WHERE oi.item_type = 'CONFIG_RENEWAL'
      AND oi.fulfillment_status = 'IN_PROGRESS'
  );

COMMIT;
