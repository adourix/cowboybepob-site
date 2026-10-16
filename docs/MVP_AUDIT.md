# MVP Architecture Audit

Basis: `SITE_ARCHITECTURE.md` supplied with the project.

## Implemented / hardened

- PostgreSQL domain model for customers, staff, sessions, providers, hosts, endpoints, catalog, routers, Tailscale devices, services, configs, allocations, subscriptions, orders, payments, refunds, jobs and audit logs.
- Staff authentication with Argon2id, TOTP and RBAC.
- Session cookie + CSRF double-submit protection.
- Application-level AES-256-GCM encryption for TOTP/client credentials.
- Customer ownership scoping on customer service, router, order and config reads.
- Secret reveal is permission-gated and audited.
- Checkout idempotency through `Idempotency-Key`.
- Capacity reservation uses an atomic `allocated_count < max_services` update.
- Worker claims jobs with PostgreSQL `FOR UPDATE SKIP LOCKED`.
- Provisioning uses plan duration instead of a hard-coded 30-day expiry.
- Marzban create/update is idempotent by deterministic username.
- Renewal keeps the existing service/config/allocation and updates provider expiry.
- Expiry sweep disables provider users, then retires allocation/capacity and deletes provider users after retention.
- Native deployment uses Nginx :5001 and API localhost :5002; Docker is not required at runtime.
- Admin and customer web views are functional MVP views with RTL support.
- Added architecture smoke tests under `npm test`.

## Deliberate MVP gaps

These are not silently represented as complete features:

1. Tailscale device synchronization and real router gateway calls are not yet a full fleet implementation.
2. Router provisioning/replacement state machine is represented in the DB/UI foundation but does not yet execute real OpenWrt/Tailscale operations.
3. Payment gateway webhook verification is not a complete provider integration; manual payment is the working MVP path.
4. Admin settings are currently read-focused; full CRUD for every setting is not exposed in the UI.
5. Full admin CRUD/action coverage from the architecture table is broader than the current UI/API surface.
6. Admin isolation to a private tailnet/allowlist listener is not yet enforced by the deployment config; the current MVP exposes the admin UI through the same public site listener.
7. Automatic migration/reconcile and notification integrations are still foundation-level rather than a complete fleet service.

## Test gates

The intended release gate is:

```bash
npm install
npm test
npm run typecheck
npm run build
```

Then on the target server:

```bash
sudo deploy/audit-native.sh
curl http://127.0.0.1:5002/health
curl http://127.0.0.1:5001/health
```

The repository CI runs the architecture smoke suite before typecheck/build.
