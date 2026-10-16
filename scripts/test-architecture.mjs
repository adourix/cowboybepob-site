import { readFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert';

const read = (p) => readFile(p, 'utf8');
const schema = await read('db/schema.sql');
const api = await read('apps/api/src/main.ts');
const worker = await read('apps/api/src/worker.ts');
const web = await read('apps/web/src/main.tsx');
const css = await read('apps/web/src/styles.css');

function contains(source, value, message){
  assert.ok(source.includes(value), message);
}

const requiredTables = [
  'customers','staff_users','auth_sessions','provider_instances','hosts','server_endpoints',
  'config_categories','category_endpoints','config_plans','router_products','routers',
  'tailscale_devices','router_replacements','services','configs','proxy_accounts',
  'service_allocations','subscriptions','subscription_periods','orders','order_items',
  'payments','payment_events','refunds','jobs','audit_logs','app_settings'
];
for (const table of requiredTables) contains(schema, `CREATE TABLE IF NOT EXISTS ${table}(`, `missing table: ${table}`);

const requiredRoutes = [
  "'/api/v1/auth/login'","'/api/v1/auth/logout'","'/api/v1/customer/profile'",
  "'/catalog/categories'","'/services'","'/services/:id/config'","'/services/:id/renew'",
  "'/routers/:id/replacement-requests'","'/orders'","'/orders/:id/pay'",
  "'/dashboard'","'/customers'","'/services'","'/routers'","'/servers'",
  "'/catalog'","'/orders'","'/payments'","'/jobs'","'/audit-logs'"
];
for (const route of requiredRoutes) contains(api, route, `missing API route fragment: ${route}`);

for (const job of ['fulfill_order','provision_service','renew_service']) contains(worker, `job.type==='${job}'`, `missing worker job: ${job}`);
contains(worker, 'FOR UPDATE SKIP LOCKED', 'worker must use DB-backed SKIP LOCKED claiming');
contains(worker, 'duration_days', 'provisioning must use plan duration');
contains(api, 'secrets:reveal', 'secret reveal must have a dedicated permission');
contains(api, 'secret.revealed', 'secret reveal must be audited');
contains(api, 'Idempotency-Key required', 'checkout must require an idempotency key');
contains(web, 'CustomerPortal', 'customer portal missing');
contains(web, '/admin/services', 'admin services page missing');
contains(web, '/admin/routers', 'admin routers page missing');
contains(web, '/admin/servers', 'admin servers page missing');
contains(css, 'margin-left:264px', 'desktop sidebar layout regression detected');
assert.doesNotMatch(web, /docker-compose|Docker Desktop/, 'web UI must not depend on Docker');

console.log(`Architecture smoke tests passed: ${requiredTables.length} tables + API/worker/UI invariants.`);
