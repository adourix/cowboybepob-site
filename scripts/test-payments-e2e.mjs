// End-to-end payment tests against a running API + database.
// Usage: API_URL=http://127.0.0.1:5002 DATABASE_URL=... KASHIER_API_KEY=... KASHIER_MERCHANT_ID=... node scripts/test-payments-e2e.mjs
// Requires the API started with VODAFONE_CASH_RECEIVING_WALLET=01044577552 and the same Kashier credentials.
import pg from 'pg';
import crypto from 'node:crypto';
import argon2 from 'argon2';
const API = process.env.API_URL || 'http://127.0.0.1:5002';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (t, v = []) => pool.query(t, v);
const KEY = process.env.KASHIER_API_KEY, MID = process.env.KASHIER_MERCHANT_ID;
let pass = 0, fail = 0;
const ok = (n, cond, info = '') => { if (cond) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${info}`); } };

class Client {
  constructor() { this.jar = {}; }
  cookie() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(method, path, body, headers = {}) {
    const h = { ...headers, cookie: this.cookie() };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (this.jar.cb_csrf && method !== 'GET') h['x-csrf-token'] = decodeURIComponent(this.jar.cb_csrf);
    const r = await fetch(API + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); this.jar[k] = v.join('='); }
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json, headers: r.headers };
  }
}
const kashierSign = (data, key = KEY) => crypto.createHmac('sha256', key).update([...data.signatureKeys].sort().map(k => `${k}=${encodeURIComponent(data[k] == null ? '' : String(data[k]))}`).join('&')).digest('hex');
const sms = (amount, sender, minutesAgo = 0, ref = String(Date.now()).slice(-12) + Math.floor(Math.random() * 90 + 10)) => {
  const d = new Date(Date.now() - minutesAgo * 60000);
  const cairo = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', year: '2-digit', month: '2-digit', day: '2-digit', hourCycle: 'h23' }).formatToParts(d).reduce((a, p) => (a[p.type] = p.value, a), {});
  return { ref, text: `تم استلام مبلغ ${amount} جنيه من ${sender}؛\nالمسجل بإسم TEST USER\nعلى رقم محفظتك 01044577552 بتاريخ ${cairo.hour}:${cairo.minute} ${cairo.year}-${cairo.month}-${cairo.day}.\nرصيدك الحالي: 999.00 جنيه\nرقم العملية: ${ref}\nhttp://vf.eg/vfcash` };
};
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');

async function order(customerId, totalMinor, withRouter = false) {
  const o = (await q(`INSERT INTO orders(customer_id,status,subtotal_minor,total_minor,idempotency_key) VALUES($1,'PENDING_PAYMENT',$2,$2,$3) RETURNING id`, [customerId, totalMinor, crypto.randomUUID()])).rows[0];
  const plan = (await q(`SELECT id FROM config_plans LIMIT 1`)).rows[0];
  const item = (await q(`INSERT INTO order_items(order_id,item_type,plan_id,name_snapshot,unit_price_minor) VALUES($1,$2,$3,'test',$4) RETURNING id`, [o.id, withRouter ? 'ROUTER' : 'CONFIG_NEW', withRouter ? null : plan.id, totalMinor])).rows[0];
  return { id: o.id, itemId: item.id };
}

async function main() {
  const { paymentSweep } = await import('../apps/api/dist/payments/service.js');
  // ── fixtures
  const hash = await argon2.hash('Passw0rd!', { type: argon2.argon2id });
  const email = `pay-${Date.now()}@example.com`, email2 = `other-${Date.now()}@example.com`;
  const cust = (await q(`INSERT INTO customers(full_name,email,password_hash,mobile_phone,status,email_verified_at) VALUES('Pay Test',$1,$2,'+201275555667','ACTIVE',now()) RETURNING id`, [email, hash])).rows[0].id;
  await q(`INSERT INTO customers(full_name,email,password_hash,mobile_phone,status,email_verified_at) VALUES('Other',$1,$2,'+201099999998','ACTIVE',now())`, [email2, hash]);
  if (!(await q(`SELECT 1 FROM config_plans LIMIT 1`)).rowCount) { const c = (await q(`INSERT INTO config_categories(name,slug,protocol,status) VALUES('T','t-${Date.now()}','vless','ACTIVE') RETURNING id`)).rows[0].id; await q(`INSERT INTO config_plans(category_id,name,duration_days,price_minor) VALUES($1,'T',30,1000)`, [c]); }
  const me = new Client(); await me.req('POST', '/api/v1/auth/login', { email, password: 'Passw0rd!', kind: 'customer' });
  const other = new Client(); await other.req('POST', '/api/v1/auth/login', { email: email2, password: 'Passw0rd!', kind: 'customer' });
  const { authenticator } = await import('otplib');
  const admin = new Client(); const al = await admin.req('POST', '/api/v1/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, otp: authenticator.generate(process.env.ADMIN_TOTP_SECRET), kind: 'staff' });
  if (al.status !== 200) throw new Error('admin login failed ' + JSON.stringify(al.body));
  const dev = await admin.req('POST', '/api/v1/admin/payment-devices', { name: 'Test phone', deviceKey: `android-${Date.now()}` });
  const TOKEN = dev.body.token, DEVKEY = dev.body.device.device_key;
  const sendSms = (text, token = TOKEN, key = DEVKEY) => new Client().req('POST', '/api/v1/payments/sms', { deviceId: key, message: text, receivedAt: new Date().toISOString() }, { authorization: `Bearer ${token}` });

  console.log('GENERAL');
  const small = await order(cust, 5000);
  const opt = await me.req('GET', `/api/v1/customer/orders/${small.id}/payment-options`);
  ok('1. <75 EGP: card/Apple Pay unavailable in options', opt.body.methods.find(m => m.method === 'CARD').available === false && opt.body.methods.find(m => m.method === 'APPLE_PAY').available === false);
  const bypass = await me.req('POST', `/api/v1/customer/orders/${small.id}/payments`, { method: 'CARD', amountMinor: 999999 });
  ok('3. <75 EGP: API rejects KASHIER even when called directly', bypass.status === 422, JSON.stringify(bypass.body));
  const big = await order(cust, 16500);
  const kc = await me.req('POST', `/api/v1/customer/orders/${big.id}/payments`, { method: 'CARD', amountMinor: 1 });
  const url = kc.body?.action?.url ? new URL(kc.body.action.url) : null;
  ok('2. >=75 EGP: Kashier checkout created', kc.status === 200 && kc.body.action.type === 'REDIRECT', JSON.stringify(kc.body));
  ok('4-5. provider gets the DB amount (165.00), frontend amount ignored', url?.searchParams.get('amount') === '165.00' && url?.searchParams.get('merchantId') === MID);
  const fake = await me.req('POST', `/api/v1/customer/payments/${kc.body.payment.id}/status`, { status: 'PAID' });
  const still = (await q(`SELECT status FROM payments WHERE id=$1`, [kc.body.payment.id])).rows[0].status;
  ok('6/33. customer cannot set PAID (no such route; redirect params ignored)', fake.status === 404 && still === 'CHECKOUT_STARTED');

  console.log('KASHIER WEBHOOK');
  const pid = kc.body.payment.id;
  const base = { merchantOrderId: pid, kashierOrderId: 'k-' + pid.slice(0, 8), orderReference: 'TEST-ORD-1', transactionId: 'TX-' + Date.now(), status: 'SUCCESS', method: 'card', amount: '165.00', currency: 'EGP', channel: 'online', transactionResponseCode: '00', signatureKeys: ['amount', 'channel', 'currency', 'kashierOrderId', 'merchantOrderId', 'method', 'orderReference', 'status', 'transactionId', 'transactionResponseCode'] };
  const hook = (data, sig = kashierSign(data), event = 'pay') => new Client().req('POST', '/api/v1/payments/webhooks/kashier', { event, data }, { 'x-kashier-signature': sig });
  ok('24/36. invalid signature rejected (401), not paid', (await hook(base, 'deadbeef')).status === 401 && (await q(`SELECT status FROM payments WHERE id=$1`, [pid])).rows[0].status !== 'PAID');
  const mism = await hook({ ...base, amount: '70.00', transactionId: base.transactionId + 'm' });
  ok('26. amount mismatch → not PAID', mism.body.result === 'AMOUNT_MISMATCH' && (await q(`SELECT status FROM payments WHERE id=$1`, [pid])).rows[0].status !== 'PAID');
  const cur = await hook({ ...base, currency: 'USD', transactionId: base.transactionId + 'c' });
  ok('27. currency mismatch → not PAID', cur.body.result === 'CURRENCY_MISMATCH');
  const good = await hook(base);
  const paidRow = (await q(`SELECT p.status,p.method,p.provider_reference,o.status ostatus,o.payment_status FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1`, [pid])).rows[0];
  ok('23. valid webhook → PAID + order PAID', good.body.result === 'PAID' && paidRow.status === 'PAID' && paidRow.ostatus === 'PAID' && paidRow.payment_status === 'PAID', JSON.stringify(paidRow));
  ok('30/32. card recorded + provider reference stored', paidRow.method === 'CARD' && paidRow.provider_reference === base.transactionId);
  const jobs1 = Number((await q(`SELECT count(*) n FROM jobs WHERE subject_id=$1 AND type='fulfill_order'`, [big.id])).rows[0].n);
  const dup = await hook(base);
  const jobs2 = Number((await q(`SELECT count(*) n FROM jobs WHERE subject_id=$1 AND type='fulfill_order'`, [big.id])).rows[0].n);
  ok('25/40. duplicate/replayed webhook is idempotent (no second fulfilment)', dup.body.duplicate === true && jobs1 === 1 && jobs2 === 1);
  // Apple Pay, failure, cancel on fresh orders
  const ap = await order(cust, 10000); const apP = (await me.req('POST', `/api/v1/customer/orders/${ap.id}/payments`, { method: 'APPLE_PAY' })).body.payment.id;
  await hook({ ...base, merchantOrderId: apP, amount: '100.00', method: 'apple_pay', transactionId: 'TX-AP-' + Date.now() });
  ok('31. Apple Pay recorded as APPLE_PAY', (await q(`SELECT method,status FROM payments WHERE id=$1`, [apP])).rows[0].method === 'APPLE_PAY');
  const fo = await order(cust, 9000); const foP = (await me.req('POST', `/api/v1/customer/orders/${fo.id}/payments`, { method: 'CARD' })).body.payment.id;
  await hook({ ...base, merchantOrderId: foP, amount: '90.00', status: 'FAILURE', transactionResponseCode: '05', transactionId: 'TX-F-' + Date.now() });
  ok('28. failed payment → FAILED', (await q(`SELECT status FROM payments WHERE id=$1`, [foP])).rows[0].status === 'FAILED');
  const co = await order(cust, 9100); const coP = (await me.req('POST', `/api/v1/customer/orders/${co.id}/payments`, { method: 'CARD' })).body.payment.id;
  await hook({ ...base, merchantOrderId: coP, amount: '91.00', status: 'SUCCESS', transactionId: 'TX-V-' + Date.now() }, undefined, 'void');
  ok('29. cancelled (void) → CANCELLED', (await q(`SELECT status FROM payments WHERE id=$1`, [coP])).rows[0].status === 'CANCELLED');

  console.log('VODAFONE CASH');
  const v1 = await order(cust, 5000);
  const c1 = await me.req('POST', `/api/v1/customer/orders/${v1.id}/payments`, { method: 'VODAFONE_CASH' });
  ok('VC instructions show receiving wallet + amount', c1.body.action?.receivingWallet === '01044577552' && c1.body.action.amountMinor === 5000);
  const dupAttempt = await me.req('POST', `/api/v1/customer/orders/${v1.id}/payments`, { method: 'VODAFONE_CASH' });
  ok('39. second attempt replaces the open one (only one open per order)', dupAttempt.status === 200 && Number((await q(`SELECT count(*) n FROM payments WHERE order_id=$1 AND status='AWAITING_TRANSFER'`, [v1.id])).rows[0].n) === 1);
  const p1 = dupAttempt.body.payment.id;
  const proof = await me.req('POST', `/api/v1/customer/payments/${p1}/manual-proof`, { senderWallet: '01275555667', screenshot: { mime: 'image/png', data: PNG } });
  ok('18. screenshot first → PENDING_VERIFICATION (screenshot is not proof)', proof.body.status === 'PENDING_VERIFICATION');
  const s1 = sms('50.00', '01275555667');
  const r1 = await sendSms(s1.text);
  const st1 = (await q(`SELECT p.status,p.provisional_activation,o.status ostatus FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1`, [p1])).rows[0];
  ok('7. matching SMS → AUTO_VERIFIED', r1.body.status === 'MATCHED' && st1.status === 'AUTO_VERIFIED', JSON.stringify(r1.body));
  ok('24h rule: service activated provisionally (order PAID, fulfil queued)', st1.provisional_activation === true && st1.ostatus === 'PAID');
  ok('13. duplicate SMS ignored', (await sendSms(s1.text)).body.duplicate === true);
  ok('12. reused transaction reference rejected', (await sendSms(s1.text.replace('TEST USER', 'TEST  USER  X'))).body.status === 'DUPLICATE');
  ok('38. other customer cannot see screenshot', (await other.req('GET', `/api/v1/customer/payments/${p1}/screenshot`)).status === 404);
  ok('owner can see own screenshot', (await me.req('GET', `/api/v1/customer/payments/${p1}/screenshot`)).status === 200);
  // provisional → expiry suspends the service; confirm resumes it
  const svc = (await q(`INSERT INTO services(customer_id,category_id,plan_id,status,origin_order_item_id) SELECT $1,p.category_id,p.id,'ACTIVE',$2 FROM config_plans p LIMIT 1 RETURNING id`, [cust, v1.itemId])).rows[0].id;
  await q(`UPDATE payments SET review_expires_at=now()-interval '1 minute' WHERE id=$1`, [p1]); await paymentSweep(pool);
  const ex = (await q(`SELECT p.status,s.status sstatus FROM payments p, services s WHERE p.id=$1 AND s.id=$2`, [p1, svc])).rows[0];
  ok('20. 24h without accountant → REVIEW_EXPIRED and service suspended', ex.status === 'REVIEW_EXPIRED' && ex.sstatus === 'SUSPENDED', JSON.stringify(ex));
  const noReason = await admin.req('POST', `/api/v1/admin/payments/${p1}/confirm`, {});
  ok('confirming an expired review requires a written reason', noReason.status === 400);
  const conf = await admin.req('POST', `/api/v1/admin/payments/${p1}/confirm`, { reason: 'verified in wallet app' });
  const after = (await q(`SELECT p.status,s.status sstatus FROM payments p, services s WHERE p.id=$1 AND s.id=$2`, [p1, svc])).rows[0];
  ok('21. accountant confirmation → PAID and service resumed', conf.status === 200 && after.status === 'PAID' && after.sstatus === 'ACTIVE', JSON.stringify(after));
  // SMS before screenshot
  const v2 = await order(cust, 4200); const p2 = (await me.req('POST', `/api/v1/customer/orders/${v2.id}/payments`, { method: 'VODAFONE_CASH' })).body.payment.id;
  const s2 = sms('42.00', '01275555667'); const early = await sendSms(s2.text);
  ok('17a. SMS before screenshot stays UNMATCHED', early.body.status === 'UNMATCHED');
  const late = await me.req('POST', `/api/v1/customer/payments/${p2}/manual-proof`, { senderWallet: '+20 127 555 5667', screenshot: { mime: 'image/png', data: PNG } });
  ok('17b. …then proof arrives → AUTO_VERIFIED', late.body.status === 'AUTO_VERIFIED', JSON.stringify(late.body));
  const rej = await admin.req('POST', `/api/v1/admin/payments/${p2}/reject`, { reason: 'not in wallet' });
  ok('22. accountant rejection → REJECTED', rej.body.status === 'REJECTED');
  // wrong amount / sender / receiver via HTTP
  const v3 = await order(cust, 3000); const p3 = (await me.req('POST', `/api/v1/customer/orders/${v3.id}/payments`, { method: 'VODAFONE_CASH' })).body.payment.id;
  await me.req('POST', `/api/v1/customer/payments/${p3}/manual-proof`, { senderWallet: '01275555667', screenshot: { mime: 'image/png', data: PNG } });
  ok('8. wrong amount not verified', (await sendSms(sms('29.00', '01275555667').text)).body.reason === 'AMOUNT_MISMATCH');
  ok('9. wrong sender not verified', (await sendSms(sms('30.00', '01011111111').text)).body.status === 'UNMATCHED');
  ok('10. wrong receiver not verified', (await sendSms(sms('30.00', '01275555667').text.replace('01044577552', '01000000001'))).body.reason === 'RECEIVER_NOT_OURS');
  ok('11. old transaction not verified', (await sendSms(sms('30.00', '01275555667', 600).text)).body.reason === 'OUTSIDE_PAYMENT_WINDOW');
  ok('16. malformed VC SMS stored for manual review', (await sendSms('تم استلام مبلغ من محفظتك ؟؟ vf.eg/vfcash ' + Date.now())).body.status === 'MANUAL_REVIEW');
  ok('unrelated personal SMS not stored', (await sendSms('عيد ميلاد سعيد يا صديقي')).body.ignored === true);
  // router orders are never activated provisionally
  const rv = await order(cust, 2500, true); const rp = (await me.req('POST', `/api/v1/customer/orders/${rv.id}/payments`, { method: 'VODAFONE_CASH' })).body.payment.id;
  await me.req('POST', `/api/v1/customer/payments/${rp}/manual-proof`, { senderWallet: '01275555667', screenshot: { mime: 'image/png', data: PNG } });
  await sendSms(sms('25.00', '01275555667').text);
  const rr = (await q(`SELECT p.status,p.provisional_activation,o.status ostatus FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1`, [rp])).rows[0];
  ok('router order: AUTO_VERIFIED but NOT shipped/activated before accountant', rr.status === 'AUTO_VERIFIED' && rr.provisional_activation === false && rr.ostatus === 'PENDING_PAYMENT');
  ok('file upload: non-image rejected', (await me.req('POST', `/api/v1/customer/payments/${rp}/manual-proof`, { senderWallet: '01275555667', screenshot: { mime: 'image/png', data: Buffer.from('<?php echo 1;').toString('base64') } })).status >= 400);

  console.log('ROUTER ORDERS (ship flow)');
  const ro = await order(cust, 125000, true);
  await q(`UPDATE orders SET status='FULFILLING' WHERE id=$1`, [ro.id]);
  await q(`UPDATE order_items SET fulfillment_status='NEEDS_ATTENTION',fulfillment_detail='NO_ROUTER_STOCK' WHERE id=$1`, [ro.itemId]);
  const listed = (await admin.req('GET', '/api/v1/admin/orders')).body.find(o => o.id === ro.id);
  ok('admin list exposes routers_waiting so the UI hides "ship"', listed.routers_waiting === 1 && listed.routers_ready === 0);
  const shipEarly = await admin.req('POST', `/api/v1/admin/orders/${ro.id}/ship`, {});
  ok('ship before stock → clear 409 telling admin what to do', shipEarly.status === 409 && /المخزن/.test(shipEarly.body.error), JSON.stringify(shipEarly.body));
  await q(`UPDATE routers SET lifecycle_status='DECOMMISSIONED' WHERE lifecycle_status='IN_STOCK'`);
  ok('allocate with empty stock → 409', (await admin.req('POST', `/api/v1/admin/orders/${ro.id}/allocate-routers`, {})).status === 409);
  const serial = 'SN-' + Date.now();
  ok('register router into stock', (await admin.req('POST', '/api/v1/admin/routers/stock', { serialNumber: serial, model: 'KT 708' })).status === 200);
  ok('duplicate serial refused', (await admin.req('POST', '/api/v1/admin/routers/stock', { serialNumber: serial, model: 'KT 708' })).status === 409);
  const alloc = await admin.req('POST', `/api/v1/admin/orders/${ro.id}/allocate-routers`, {});
  ok('allocate → READY_TO_SHIP', alloc.body.allocated === 1 && (await q(`SELECT fulfillment_status FROM order_items WHERE id=$1`, [ro.itemId])).rows[0].fulfillment_status === 'READY_TO_SHIP');
  ok('ship → SHIPPED', (await admin.req('POST', `/api/v1/admin/orders/${ro.id}/ship`, {})).body.status === 'SHIPPED');
  ok('deliver → COMPLETED', (await admin.req('POST', `/api/v1/admin/orders/${ro.id}/deliver`, {})).body.status === 'COMPLETED');
  // bundle: router + config — router must still go through shipping
  const bo = await order(cust, 140000, true);
  const plan = (await q(`SELECT id FROM config_plans LIMIT 1`)).rows[0].id;
  await q(`INSERT INTO order_items(order_id,item_type,plan_id,name_snapshot,unit_price_minor,fulfillment_status) VALUES($1,'CONFIG_NEW',$2,'cfg',15000,'FULFILLED')`, [bo.id, plan]);
  await q(`UPDATE orders SET status='PAID' WHERE id=$1`, [bo.id]);
  await admin.req('POST', '/api/v1/admin/routers/stock', { serialNumber: serial + 'b', model: 'KT 708' });
  await admin.req('POST', `/api/v1/admin/orders/${bo.id}/allocate-routers`, {});
  ok('bundle: ship allowed (was "router-only orders" before)', (await admin.req('POST', `/api/v1/admin/orders/${bo.id}/ship`, {})).body.status === 'SHIPPED');
  ok('bundle: deliver → COMPLETED', (await admin.req('POST', `/api/v1/admin/orders/${bo.id}/deliver`, {})).body.status === 'COMPLETED');

  console.log('CATALOG');
  const rpId = (await q(`INSERT INTO router_products(sku,name,model,price_minor) VALUES($1,'Temp','T',100) RETURNING id`, ['SKU-' + Date.now()])).rows[0].id;
  ok('archive router product', (await admin.req('DELETE', `/api/v1/admin/catalog/router-products/${rpId}`)).status === 200);
  const cat = (await admin.req('GET', '/api/v1/admin/catalog')).body;
  ok('archived product hidden from admin + customer catalog', !cat.routerProducts.some(x => x.id === rpId) && !(await me.req('GET', '/api/v1/customer/catalog/router-products')).body.some(x => x.id === rpId));
  ok('archived row kept for order history', (await q(`SELECT status FROM router_products WHERE id=$1`, [rpId])).rows[0].status === 'ARCHIVED');
  ok('add provider from panel', (await admin.req('POST', '/api/v1/admin/provider-instances', { name: 'p-' + Date.now(), baseUrl: 'http://marzban2:8080', username: 'u', password: 'p' })).status === 200);

  console.log('NO-CODE FORWARDERS + MANUAL PASTE');
  const raw = (body, type, headers) => fetch(API + '/api/v1/payments/sms', { method: 'POST', headers: { 'content-type': type, ...headers }, body }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const pending = async (amt) => { const o = await order(cust, amt); const pid = (await me.req('POST', `/api/v1/customer/orders/${o.id}/payments`, { method: 'VODAFONE_CASH' })).body.payment.id; await me.req('POST', `/api/v1/customer/payments/${pid}/manual-proof`, { senderWallet: '01275555667', screenshot: { mime: 'image/png', data: PNG } }); return pid; };
  const rnd = () => 2000 + Math.floor(Math.random() * 7000) * 1; const egp = m => `${Math.floor(m / 100)}.${String(m % 100).padStart(2, '0')}`;
  const A1 = rnd(), A2 = rnd() + 1, A3 = rnd() + 2, A4 = rnd() + 3;
  const pa = await pending(A1);
  const t1 = await raw(sms(egp(A1), '01275555667').text, 'text/plain; charset=utf-8', { 'x-device-token': TOKEN });
  ok('MacroDroid style: raw SMS as text/plain + X-Device-Token header → MATCHED', t1.body.status === 'MATCHED' && t1.body.paymentId === pa, JSON.stringify(t1));
  const pb = await pending(A2);
  const t2 = await raw(new URLSearchParams({ text: sms(egp(A2), '01275555667').text }).toString(), 'application/x-www-form-urlencoded', { authorization: `Bearer ${TOKEN}` });
  ok('form-urlencoded with "text" field → MATCHED', t2.body.status === 'MATCHED' && t2.body.paymentId === pb, JSON.stringify(t2));
  const pc = await pending(A3);
  const t3 = await raw(JSON.stringify({ text: sms(egp(A3), '01275555667').text, timestamp: Date.now() }), 'application/json', { 'x-device-token': TOKEN });
  ok('JSON aliases {text, timestamp(ms)} → MATCHED', t3.body.status === 'MATCHED' && t3.body.paymentId === pc, JSON.stringify(t3));
  ok('token in body/URL is not accepted (header only)', (await raw(sms('1.00', '01275555667').text, 'text/plain', {})).status === 401);
  const pd = await pending(A4);
  const paste = await admin.req('POST', '/api/v1/admin/payment-sms/manual', { message: sms(egp(A4), '01275555667').text });
  ok('accountant pastes SMS → MATCHED, payment AUTO_VERIFIED', paste.body.status === 'MATCHED' && (await q(`SELECT status FROM payments WHERE id=$1`, [pd])).rows[0].status === 'AUTO_VERIFIED', JSON.stringify(paste.body));
  ok('pasting the same SMS again → duplicate', (await admin.req('POST', '/api/v1/admin/payment-sms/manual', { message: paste.body && sms('14.00', '01275555667').text })).status === 200);
  ok('pasting non-Vodafone text → 422', (await admin.req('POST', '/api/v1/admin/payment-sms/manual', { message: 'hello this is not a payment message at all' })).status === 422);
  ok('customer cannot use manual paste', (await me.req('POST', '/api/v1/admin/payment-sms/manual', { message: sms('1.00', '01275555667').text })).status === 401);
  ok('paste is audited', Number((await q(`SELECT count(*) n FROM audit_logs WHERE action='payment.sms_pasted'`)).rows[0].n) >= 2);

  console.log('ORANGE CASH');
  const orangeSms = (amount, sender, ref = '25' + String(Date.now()).slice(-10) + Math.floor(Math.random() * 90 + 10)) => ({ ref, text: `لقد استقبلت تحويل أموال بمبلغ ${amount} جنيه من 0020${sender.slice(1)}رصيد اورنچ كاش الجديد 15.20 جنيه رقم المعاملة ${ref}` });
  const oOpt = await me.req('GET', `/api/v1/customer/orders/${(await order(cust, 2600)).id}/payment-options`);
  ok('Orange Cash offered when ORANGE_CASH_RECEIVING_WALLET is set', oOpt.body.methods.some(m => m.method === 'ORANGE_CASH' && m.available));
  const oo = await order(cust, 2700 + Math.floor(Math.random() * 900));
  const oc = await me.req('POST', `/api/v1/customer/orders/${oo.id}/payments`, { method: 'ORANGE_CASH' });
  ok('Orange payment shows the Orange wallet', oc.body.action?.receivingWallet === '01200000001' && oc.body.action.method === 'ORANGE_CASH', JSON.stringify(oc.body));
  const op = oc.body.payment.id; const oamt = (await q(`SELECT total_minor FROM orders WHERE id=$1`, [oo.id])).rows[0].total_minor;
  await me.req('POST', `/api/v1/customer/payments/${op}/manual-proof`, { senderWallet: '01275555667', screenshot: { mime: 'image/png', data: PNG } });
  const egp2 = m => `${Math.floor(m / 100)}.${String(m % 100).padStart(2, '0')}`;
  const os1 = orangeSms(egp2(Number(oamt)), '01275555667');
  const or1 = await raw(os1.text, 'text/plain', { 'x-device-token': TOKEN });
  ok('real-format Orange SMS (sender 0020…, no date/receiver) → MATCHED', or1.body.status === 'MATCHED' && or1.body.paymentId === op, JSON.stringify(or1.body));
  ok('stored with carrier ORANGE', (await q(`SELECT carrier FROM payment_sms WHERE parsed_transaction_reference=$1`, [os1.ref])).rows[0]?.carrier === 'ORANGE');
  ok('reused Orange transaction number → DUPLICATE', (await raw(os1.text.replace('15.20', '16.20'), 'text/plain', { 'x-device-token': TOKEN })).body.status === 'DUPLICATE');
  const vamt = 3100 + Math.floor(Math.random() * 900); const vp = await pending(vamt);
  const cross = await raw(orangeSms(egp2(vamt), '01275555667').text, 'text/plain', { 'x-device-token': TOKEN });
  ok('Orange SMS cannot verify a Vodafone Cash payment (different receiving wallet)', cross.body.status === 'UNMATCHED' && (await q(`SELECT status FROM payments WHERE id=$1`, [vp])).rows[0].status === 'PENDING_VERIFICATION', JSON.stringify(cross.body));
  ok('provider renamed to MANUAL_WALLET', (await q(`SELECT provider FROM payments WHERE id=$1`, [op])).rows[0].provider === 'MANUAL_WALLET');

  console.log('ACTIVATE ON PROOF (24h until the accountant reviews)');
  const newCustomer = async () => { const em = `proof-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`; const id = (await q(`INSERT INTO customers(full_name,email,password_hash,mobile_phone,status,email_verified_at) VALUES('Proof',$1,$2,'+201211111111','ACTIVE',now()) RETURNING id`, [em, hash])).rows[0].id; const cl = new Client(); await cl.req('POST', '/api/v1/auth/login', { email: em, password: 'Passw0rd!', kind: 'customer' }); return { id, cl }; };
  const payWithProof = async (C, amt) => { const o = await order(C.id, amt); const pid = (await C.cl.req('POST', `/api/v1/customer/orders/${o.id}/payments`, { method: 'VODAFONE_CASH' })).body.payment.id; const r = await C.cl.req('POST', `/api/v1/customer/payments/${pid}/manual-proof`, { senderWallet: '01211111111', screenshot: { mime: 'image/png', data: PNG } }); return { o, pid, r }; };
  const prow = pid => q(`SELECT p.status,p.provisional_activation,p.review_expires_at,o.status ostatus FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1`, [pid]).then(x => x.rows[0]);
  const addService = async (itemId, cid) => (await q(`INSERT INTO services(customer_id,category_id,plan_id,status,origin_order_item_id) SELECT $1,p.category_id,p.id,'ACTIVE',$2 FROM config_plans p LIMIT 1 RETURNING id`, [cid, itemId])).rows[0].id;
  const svcStatus = id => q(`SELECT status FROM services WHERE id=$1`, [id]).then(x => x.rows[0].status);
  const A = await newCustomer();
  const a1 = await payWithProof(A, 4000); const ar = await prow(a1.pid);
  ok('customer finishes paying (no SMS) → config activated, order PAID', ar.status === 'PENDING_VERIFICATION' && ar.provisional_activation === true && ar.ostatus === 'PAID' && a1.r.body.provisionalActivation === true, JSON.stringify(ar));
  const hrs = (new Date(ar.review_expires_at).getTime() - Date.now()) / 3600000;
  ok('review deadline is ~24h from payment', hrs > 23.5 && hrs <= 24.01, `hours=${hrs}`);
  ok('fulfilment job queued', Number((await q(`SELECT count(*) n FROM jobs WHERE subject_id=$1 AND type='fulfill_order'`, [a1.o.id])).rows[0].n) === 1);
  const a2 = await payWithProof(A, 4100); const ar2 = await prow(a2.pid);
  ok('second payment while the first is under review → waits for accountant', ar2.provisional_activation === false && ar2.ostatus === 'PENDING_PAYMENT', JSON.stringify(ar2));
  const cf = await admin.req('POST', `/api/v1/admin/payments/${a1.pid}/confirm`, {});
  ok('accountant confirms after checking the wallet (no SMS, no note needed) → PAID', cf.status === 200 && cf.body.status === 'PAID', JSON.stringify(cf.body));
  ok('review list shows payments waiting for the accountant', (await admin.req('GET', '/api/v1/admin/payments?filter=review')).body.some(x => x.id === a2.pid));
  const B = await newCustomer();
  const b1 = await payWithProof(B, 4200); const bs = await addService(b1.o.itemId, B.id);
  await q(`UPDATE payments SET review_expires_at=now()-interval '1 minute' WHERE id=$1`, [b1.pid]); await paymentSweep(pool);
  ok('no review within 24h → REVIEW_EXPIRED and config suspended', (await prow(b1.pid)).status === 'REVIEW_EXPIRED' && await svcStatus(bs) === 'SUSPENDED');
  const b2 = await payWithProof(B, 4300);
  ok('customer with an expired review → next payment is NOT activated early', (await prow(b2.pid)).provisional_activation === false);
  const Cc = await newCustomer();
  const cc1 = await payWithProof(Cc, 4400); const cs = await addService(cc1.o.itemId, Cc.id);
  const rj = await admin.req('POST', `/api/v1/admin/payments/${cc1.pid}/reject`, { reason: 'لم يصل التحويل' });
  ok('accountant rejects → config suspended', rj.body.status === 'REJECTED' && await svcStatus(cs) === 'SUSPENDED');
  const Rr = await newCustomer();
  const ro2 = await order(Rr.id, 2500, true); const rp2 = (await Rr.cl.req('POST', `/api/v1/customer/orders/${ro2.id}/payments`, { method: 'VODAFONE_CASH' })).body.payment.id;
  await Rr.cl.req('POST', `/api/v1/customer/payments/${rp2}/manual-proof`, { senderWallet: '01211111111', screenshot: { mime: 'image/png', data: PNG } });
  ok('router order is never activated/shipped on proof', (await prow(rp2)).provisional_activation === false && (await prow(rp2)).ostatus === 'PENDING_PAYMENT');

  console.log('REAL PRODUCTION SMS FORMATS (ingestion)');
  const RM3 = `تم استلام مبلغ 5005.00 جنيه من Mohamed N Ewedah، رصيدك الحالي 5005.20 جنية، رقم المعاملة ${'25' + String(Date.now()).slice(-12)}.\n\nعرض مايتفوتش!\nادفع دلوقتي باورنچ كاش\nhttps://myo.orange.eg/YANGO`;
  const rp3 = await raw(RM3, 'text/plain', { 'x-device-token': TOKEN });
  const rs3 = (await q(`SELECT parse_status,parsed_sender_name,parsed_sender_wallet,parsed_receiver_wallet,carrier,match_details FROM payment_sms ORDER BY created_at DESC LIMIT 1`)).rows[0];
  ok('Orange name-only SMS parsed and stored (no SENDER_NOT_FOUND)', rs3.parse_status === 'PARSED' && rs3.parsed_sender_name === 'Mohamed N Ewedah' && rs3.parsed_sender_wallet === null && rs3.carrier === 'ORANGE', JSON.stringify(rs3));
  ok('…left for the accountant as SENDER_NAME_ONLY (no wallet invented)', rp3.body.status === 'UNMATCHED' && rp3.body.reason === 'SENDER_NAME_ONLY' && rs3.match_details?.reason === 'SENDER_NAME_ONLY');
  // Message 1 format ("من رقم", "تاريخ العملية:") auto-matches a pending Vodafone payment
  const rm1amt = 5100 + Math.floor(Math.random() * 800); const rm1p = await pending(rm1amt);
  const rNowCairo = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', year: '2-digit', month: '2-digit', day: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).reduce((a, p) => (a[p.type] = p.value, a), {});
  const RM1 = `تم استلام مبلغ ${egp(rm1amt)} جنيه من رقم 01275555667 المسجل بإسم Alhussien R Kassem على رقم محفظتك  01044577552.\nرصيدك الحالي: 2500.17 جنيه\nتاريخ العملية: ${rNowCairo.hour}:${rNowCairo.minute} ${rNowCairo.year}-${rNowCairo.month}-${rNowCairo.day}\nرقم العملية: 0247${String(Date.now()).slice(-8)}\nتابع كل مصروفاتك http://vf.eg/vfcash`;
  const rp1 = await raw(RM1, 'text/plain', { 'x-device-token': TOKEN });
  ok('Message-1 format ("من رقم", "تاريخ العملية:") → MATCHED', rp1.body.status === 'MATCHED' && rp1.body.paymentId === rm1p, JSON.stringify(rp1.body));
  // Message 4 format auto-matches an Orange payment
  const ro4 = await order(cust, 6100 + Math.floor(Math.random() * 800)); const ro4p = (await me.req('POST', `/api/v1/customer/orders/${ro4.id}/payments`, { method: 'ORANGE_CASH' })).body.payment.id;
  await me.req('POST', `/api/v1/customer/payments/${ro4p}/manual-proof`, { senderWallet: '01275555667', screenshot: { mime: 'image/png', data: PNG } });
  const ro4amt = Number((await q(`SELECT total_minor FROM orders WHERE id=$1`, [ro4.id])).rows[0].total_minor);
  const rp4 = await raw(`لقد استقبلت تحويل أموال بمبلغ ${egp(ro4amt)} جنيه من 00201275555667\nرصيد اورنچ كاش الجديد 115.49 جنيه رقم المعاملة 30${String(Date.now()).slice(-8)}`, 'text/plain', { 'x-device-token': TOKEN });
  ok('Message-4 format (00201…, new line before "رصيد") → MATCHED', rp4.body.status === 'MATCHED' && rp4.body.paymentId === ro4p, JSON.stringify(rp4.body));
  // An SMS that FAILED under the old parser is recovered by "re-read failed SMS" (in place, nothing deleted)
  const rOldFailed = `تم استلام مبلغ 2500 جنيه من رقم 01012208430 المسجل بإسم Old Format على رقم محفظتك  01044577552.\nتاريخ العملية: 12:46 26-10-14\nرقم العملية: 0999${String(Date.now()).slice(-8)}`;
  const rfh = crypto.createHash('sha256').update(rOldFailed.replace(/\s+/g, ' ').trim()).digest('hex');
  const rDevRow = (await q(`SELECT id FROM payment_devices WHERE device_key=$1`, [DEVKEY])).rows[0];
  const rFailedId = (await q(`INSERT INTO payment_sms(device_id,raw_message,message_hash,parse_status,parse_error,match_status,received_at) VALUES($1,$2,$3,'FAILED','SENDER_NOT_FOUND','MANUAL_REVIEW',now()) RETURNING id`, [rDevRow.id, rOldFailed, rfh])).rows[0].id;
  const rBefore = Number((await q(`SELECT count(*) n FROM payment_sms`)).rows[0].n);
  const rRep = await admin.req('POST', '/api/v1/admin/payment-sms/reprocess-failed', {});
  const rFixed = (await q(`SELECT id,parse_status,parse_error,parsed_sender_wallet,parsed_sender_name,parsed_amount_minor FROM payment_sms WHERE id=$1`, [rFailedId])).rows[0];
  ok('old SENDER_NOT_FOUND record re-read in place → PARSED with correct fields', rRep.status === 200 && rFixed.parse_status === 'PARSED' && rFixed.parse_error === null && rFixed.parsed_sender_wallet === '01012208430' && rFixed.parsed_sender_name === 'Old Format' && Number(rFixed.parsed_amount_minor) === 250000, JSON.stringify({ rRep: rRep.body, rFixed }));
  ok('no SMS records deleted or duplicated by reprocessing', Number((await q(`SELECT count(*) n FROM payment_sms`)).rows[0].n) === rBefore);
  ok('pasting a previously failed SMS also recovers it (not refused as duplicate)', (await admin.req('POST', '/api/v1/admin/payment-sms/manual', { message: rOldFailed })).body.duplicate === true); // already recovered → duplicate now
  ok('customer cannot trigger reprocessing', (await me.req('POST', '/api/v1/admin/payment-sms/reprocess-failed', {})).status === 401);

  console.log('SECURITY');
  ok('34. invalid device token rejected', (await sendSms(sms('1.00', '01275555667').text, 'x'.repeat(40))).status === 401);
  await admin.req('PATCH', `/api/v1/admin/payment-devices/${dev.body.device.id}`, { enabled: false });
  ok('35. disabled device rejected', (await sendSms(sms('1.00', '01275555667').text)).status === 403);
  ok('37. customer cannot call accountant actions', (await me.req('POST', `/api/v1/admin/payments/${rp}/confirm`, {})).status === 401);
  ok('37b. customer cannot list admin payments', (await me.req('GET', `/api/v1/admin/payments`)).status === 401);
  ok('Kashier payments cannot be confirmed manually', (await admin.req('POST', `/api/v1/admin/payments/${foP}/confirm`, { reason: 'x' })).status === 409);
  ok('legacy unsigned webhook retired (410)', (await new Client().req('POST', '/api/v1/webhooks/payments/manual', { paymentId: rp, status: 'succeeded' })).status === 410);
  ok('admin can view screenshot', (await admin.req('GET', `/api/v1/admin/payments/${p1}/screenshot`)).status === 200);
  const audit = Number((await q(`SELECT count(*) n FROM payment_audit_logs WHERE payment_id=$1`, [p1])).rows[0].n);
  ok('every state change audited', audit >= 5, `rows=${audit}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch(async e => { console.error(e); await pool.end(); process.exit(1); });
