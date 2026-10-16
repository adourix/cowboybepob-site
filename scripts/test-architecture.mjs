import { readFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert';

const read = (p) => readFile(p, 'utf8');
const schema = await read('db/schema.sql');
const api = await read('apps/api/src/main.ts');
const worker = await read('apps/api/src/worker.ts');
const web = await read('apps/web/src/main.tsx');
const css = await read('apps/web/src/styles.css');

const requiredTables = [
  'customers','staff_users','auth_sessions','provider_instances','hosts','server_endpoints',
  'config_categories','category_endpoints','config_plans','router_products','routers',
  'tailscale_devices','router_replacements','services','configs','proxy_accounts',
  'service_allocations','subscriptions','subscription_periods','orders','order_items',
  'payments','payment_events','refunds','jobs','audit_logs','app_settings'
];
for (const table of requiredTables) assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`), `missing table: ${table}`);

for (const path of [
  "'/api/v1/auth/login'","'/api/v1/auth/logout'","'/api/v1/customer/profile'",
  "'/api/v1/customer/catalog/categories'","'/api/v1/customer/services'",
  "'/api/v1/customer/services/:id/config'","'/api/v1/customer/services/:id/renew'",
  "'/api/v1/customer/routers/:id/replacement-requests'","'/api/v1/customer/orders'",
  "'/api/v1/customer/orders/:id/pay'","'/api/v1/admin/dashboard'","'/api/v1/admin/customers'",
  "'/api/v1/admin/services'","'/api/v1/admin/routers'","'/api/v1/admin/servers'",
  "'/api/v1/admin/catalog'","'/api/v1/admin/orders'","'/api/v1/admin/payments'",
  "'/api/v1/admin/jobs'","'/api/v1/admin/audit-logs'"
]) assert.match(api, new RegExp(path.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), `missing API route: ${path}`);

for (const job of ['fulfill_order','provision_service','renew_service']) assert.match(worker, new RegExp(`job\.type===['\"]${job}['\"]`), `missing worker job: ${job}`);
assert.match(worker, /FOR UPDATE SKIP LOCKED/, 'worker must use DB-backed SKIP LOCKED claiming');
assert.match(worker, /duration_days/, 'provisioning must use plan duration');
assert.match(api, /secrets:reveal/, 'secret reveal must have a dedicated permission');
assert.match(api, /secret\.revealed/, 'secret reveal must be audited');
assert.match(api, /Idempotency-Key/i, 'checkout must require an idempotency key');
assert.match(web, /CustomerPortal/, 'customer portal missing');
assert.match(web, /\/admin\/services/, 'admin services page missing');
assert.match(web, /\/admin\/routers/, 'admin routers page missing');
assert.match(web, /\/admin\/servers/, 'admin servers page missing');
assert.match(css, /margin-left:264px/, 'desktop sidebar layout regression detected');
assert.doesNotMatch(web, /docker-compose|Docker Desktop/, 'web UI must not depend on Docker');

console.log(`Architecture smoke tests passed: ${requiredTables.length} tables + API/worker/UI invariants.`);
