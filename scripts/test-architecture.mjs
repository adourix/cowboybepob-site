import { readFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert';

const read = (p) => readFile(p, 'utf8');
const schema = await read('db/schema.sql');
const api = await read('apps/api/src/main.ts');
const worker = await read('apps/api/src/worker-v2.ts');
const workerPackage = JSON.parse(await read('apps/api/package.json'));
const endpointSync = await read('apps/api/src/endpointSync.ts');
const marzban = await read('apps/api/src/marzban.ts');
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
contains(schema, 'credentials_enc bytea', 'provider credential encryption column missing from canonical schema');

const requiredPrefixes = [
  "prefix:'/api/v1/admin'",
  "prefix:'/api/v1/customer'"
];
for (const prefix of requiredPrefixes) contains(api, prefix, `missing API route prefix: ${prefix}`);

const requiredRoutes = [
  "'/api/v1/auth/login'","'/api/v1/auth/logout'","'/api/v1/customer/auth/register'",
  "'/catalog/categories'","'/services'","'/services/:id/config'","'/services/:id/renew'",
  "'/routers/:id/replacement-requests'","'/orders'","'/orders/:id/pay'",
  "'/dashboard'","'/customers'","'/services'","'/routers'","'/servers'",
  "'/catalog'","'/orders'","'/payments'","'/jobs'","'/audit-logs'"
];
for (const route of requiredRoutes) contains(api, route, `missing API route fragment: ${route}`);

const requiredWorkerHandlers = [
  ['fulfill_order', 'async function fulfillOrder'],
  ['provision_service', 'async function provisionService'],
  ['renew_service', 'async function renewService']
];
for (const [job, handler] of requiredWorkerHandlers) {
  contains(worker, handler, `missing worker handler: ${job}`);
  contains(worker, `'${job}'`, `missing worker job type: ${job}`);
}
contains(worker, 'FOR UPDATE SKIP LOCKED', 'worker must use DB-backed SKIP LOCKED claiming');
contains(worker, 'duration_days', 'provisioning must use plan duration');
contains(worker, 'proxy_account_id', 'allocation must retain its proxy account');
contains(worker, 'manual_link_enc', 'provider-generated client link must be persisted');
contains(worker, 'PROVIDER_4XX', 'permanent provider failure must surface on the order item');
contains(worker, 'recoverStaleJobs', 'worker must recover abandoned locks');
contains(worker, 'syncAllEndpoints', 'worker must refresh endpoint inventory');
contains(marzban, 'flattenInboundResponse', 'Marzban adapter must normalize grouped inbounds');
contains(endpointSync, 'markUnseenEndpoints', 'endpoint sync must retire removed inbounds');
contains(marzban, 'providerId', 'Marzban adapter must support provider-specific credentials');
contains(marzban, 'AbortSignal.timeout', 'Marzban calls must have a bounded timeout');
contains(marzban, 'protocol: String((item as any).protocol || protocol)', 'grouped inbound protocols must be preserved');
assert.equal(workerPackage.scripts.worker, 'node dist/worker-v2.js', 'production worker must use the hardened implementation');
contains(api, 'secrets:reveal', 'secret reveal must have a dedicated permission');
contains(api, 'secret.revealed', 'secret reveal must be audited');
contains(api, 'Idempotency-Key required', 'checkout must require an idempotency key');
contains(web, 'CustomerPortal', 'customer portal missing');
contains(web, '/admin/services', 'admin services page missing');
contains(web, '/admin/routers', 'admin routers page missing');
contains(web, '/admin/servers', 'admin servers page missing');
contains(css, 'margin-left:264px', 'desktop sidebar layout regression detected');
assert.doesNotMatch(web, /docker-compose|Docker Desktop/, 'web UI must not depend on Docker');

console.log(`Architecture smoke tests passed: ${requiredTables.length} tables + API/worker/UI/provider invariants.`);
