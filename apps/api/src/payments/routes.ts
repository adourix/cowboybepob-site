import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { isPaymentMethod } from './availability.js';
import { authenticateDevice, confirmPayment, createDevice, createPayment, getCustomerPayment, handleKashierWebhook, ingestSms, paymentOptions, PaymentError, plog, readScreenshot, rejectPayment, submitManualProof } from './service.js';

type Deps = { pool: Pool; requirePermission: (req: any, perm: string) => void; requireCsrf: (req: any) => void };
/** Per-session rate-limit key: mobile carriers put many customers behind one IP (CGNAT). */
const bySession = (req: any) => { const m = /(?:^|;\s*)cb_session=([^;]+)/.exec(String(req.headers.cookie || '')); return m ? 's:' + crypto.createHash('sha256').update(m[1]).digest('hex').slice(0, 24) : 'ip:' + req.ip; };
const isUuid = (v: any) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const needUuid = (v: any) => { if (!isUuid(v)) throw new PaymentError('Not found', 404, 'NOT_FOUND'); return v as string; };

/* Customer: method selection, Vodafone proof, status polling, own screenshot. */
export function registerCustomerPaymentRoutes(customer: FastifyInstance, d: Deps) {
  customer.get('/orders/:id/payment-options', async (req: any) => paymentOptions(d.pool, needUuid(req.params.id), req.principal.id));
  customer.post('/orders/:id/payments', { config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: bySession } } }, async (req: any) => {
    d.requireCsrf(req);
    const method = String(req.body?.method || '').toUpperCase();
    if (!isPaymentMethod(method)) throw new PaymentError('طريقة دفع غير معروفة.', 400, 'BAD_METHOD');
    plog('PAYMENT_METHOD_SELECTED', { orderId: req.params.id, method });
    return createPayment(d.pool, { orderId: needUuid(req.params.id), customerId: req.principal.id, method }); // body amount is ignored on purpose
  });
  // Backwards compatible: old clients called /pay right after creating an order.
  customer.post('/orders/:id/pay', async (req: any) => { d.requireCsrf(req); return createPayment(d.pool, { orderId: needUuid(req.params.id), customerId: req.principal.id, method: 'VODAFONE_CASH' }); });
  customer.post('/payments/:id/manual-proof', { bodyLimit: 7 * 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: '10 minutes', keyGenerator: bySession } } }, async (req: any) => {
    d.requireCsrf(req);
    const b = req.body || {};
    return submitManualProof(d.pool, { paymentId: needUuid(req.params.id), customerId: req.principal.id, senderWallet: String(b.senderWallet || ''), screenshot: b.screenshot?.data ? { base64: String(b.screenshot.data), mime: String(b.screenshot.mime || '') } : undefined });
  });
  customer.get('/payments/:id', async (req: any) => getCustomerPayment(d.pool, needUuid(req.params.id), req.principal.id));
  customer.get('/payments/:id/screenshot', async (req: any, reply: any) => {
    const p = (await d.pool.query(`SELECT p.screenshot_path,p.screenshot_mime FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1 AND o.customer_id=$2`, [needUuid(req.params.id), req.principal.id])).rows[0];
    if (!p?.screenshot_path) throw new PaymentError('Not found', 404, 'NOT_FOUND');
    return reply.header('Content-Type', p.screenshot_mime).header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff').send(await readScreenshot(p.screenshot_path));
  });
}

/* Accountant dashboard. */
export function registerAdminPaymentRoutes(admin: FastifyInstance, d: Deps) {
  admin.get('/payments', async (req: any) => {
    d.requirePermission(req, 'payments:read');
    const f = String(req.query?.filter || 'all').toLowerCase();
    const where: Record<string, string> = {
      all: 'true', pending: `p.status IN ('AWAITING_TRANSFER','PENDING_VERIFICATION','CREATED','CHECKOUT_STARTED','PROCESSING')`, auto_verified: `p.status='AUTO_VERIFIED'`, paid: `p.status='PAID'`,
      rejected: `p.status IN ('REJECTED','FAILED','CANCELLED')`, expired: `p.status IN ('EXPIRED','REVIEW_EXPIRED')`, kashier: `p.provider='KASHIER'`, vodafone_cash: `p.method='VODAFONE_CASH'`, orange_cash: `p.method='ORANGE_CASH'`, card: `p.method='CARD'`, apple_pay: `p.method='APPLE_PAY'`,
    };
    if (!where[f]) throw new PaymentError('Unknown filter', 400, 'BAD_FILTER');
    return (await d.pool.query(`SELECT p.id,p.order_id,p.provider,p.method,p.status,p.amount_minor,p.currency,p.customer_wallet,p.receiving_wallet,p.provider_reference,p.provider_status,p.webhook_status,p.webhook_received_at,p.screenshot_path IS NOT NULL has_screenshot,p.match_details,p.expires_at,p.review_expires_at,p.auto_verified_at,p.verified_at,p.provisional_activation,p.created_at,
      o.public_code order_code,c.full_name customer_name,c.public_code customer_code,
      (SELECT json_build_object('reference',s.parsed_transaction_reference,'time',s.parsed_transaction_time,'sender',s.parsed_sender_wallet,'amountMinor',s.parsed_amount_minor) FROM payment_sms s WHERE s.payment_id=p.id ORDER BY s.created_at DESC LIMIT 1) sms
      FROM payments p JOIN orders o ON o.id=p.order_id JOIN customers c ON c.id=o.customer_id WHERE ${where[f]} ORDER BY CASE p.status WHEN 'AUTO_VERIFIED' THEN 0 WHEN 'PENDING_VERIFICATION' THEN 1 ELSE 2 END, p.created_at DESC LIMIT 300`)).rows;
  });
  admin.get('/payments/:id', async (req: any) => {
    d.requirePermission(req, 'payments:read');
    const id = needUuid(req.params.id);
    const p = (await d.pool.query(`SELECT p.*,o.public_code order_code,o.total_minor,c.full_name customer_name,c.mobile_phone customer_mobile FROM payments p JOIN orders o ON o.id=p.order_id JOIN customers c ON c.id=o.customer_id WHERE p.id=$1`, [id])).rows[0];
    if (!p) throw new PaymentError('Not found', 404, 'NOT_FOUND');
    const sms = (await d.pool.query(`SELECT id,raw_message,parse_status,parse_error,parsed_amount_minor,parsed_sender_wallet,parsed_sender_name,parsed_receiver_wallet,parsed_transaction_reference,parsed_transaction_time,match_status,match_details,received_at FROM payment_sms WHERE payment_id=$1 ORDER BY created_at DESC`, [id])).rows;
    const audit = (await d.pool.query(`SELECT actor_type,actor_id,previous_status,new_status,reason,metadata,created_at FROM payment_audit_logs WHERE payment_id=$1 ORDER BY created_at`, [id])).rows;
    const events = (await d.pool.query(`SELECT event_id,payload,result,received_at,processed_at FROM payment_events WHERE payment_id=$1 ORDER BY received_at`, [id])).rows;
    const { screenshot_path, ...safe } = p;
    return { ...safe, has_screenshot: Boolean(screenshot_path), sms, audit, events };
  });
  admin.get('/payments/:id/screenshot', async (req: any, reply: any) => {
    d.requirePermission(req, 'payments:read');
    const p = (await d.pool.query('SELECT screenshot_path,screenshot_mime FROM payments WHERE id=$1', [needUuid(req.params.id)])).rows[0];
    if (!p?.screenshot_path) throw new PaymentError('Not found', 404, 'NOT_FOUND');
    return reply.header('Content-Type', p.screenshot_mime).header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff').send(await readScreenshot(p.screenshot_path));
  });
  admin.post('/payments/:id/confirm', async (req: any) => { d.requirePermission(req, 'payments:write'); d.requireCsrf(req); return confirmPayment(d.pool, { paymentId: needUuid(req.params.id), staffId: req.principal.id, reason: req.body?.reason }); });
  admin.post('/payments/:id/reject', async (req: any) => { d.requirePermission(req, 'payments:write'); d.requireCsrf(req); return rejectPayment(d.pool, { paymentId: needUuid(req.params.id), staffId: req.principal.id, reason: String(req.body?.reason || '') }); });
  admin.get('/payment-sms', async (req: any) => {
    d.requirePermission(req, 'payments:read');
    return (await d.pool.query(`SELECT s.id,s.parse_status,s.parse_error,s.parsed_amount_minor,s.parsed_sender_wallet,s.parsed_receiver_wallet,s.parsed_transaction_reference,s.parsed_transaction_time,s.match_status,s.match_details,s.received_at,dv.name device_name FROM payment_sms s LEFT JOIN payment_devices dv ON dv.id=s.device_id WHERE s.payment_id IS NULL ORDER BY s.created_at DESC LIMIT 200`)).rows;
  });
  // No phone? The accountant pastes the Vodafone Cash SMS; same parser, matcher and duplicate checks.
  admin.post('/payment-sms/manual', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req: any) => {
    d.requirePermission(req, 'payments:write'); d.requireCsrf(req);
    const message = String(req.body?.message || '').trim();
    if (!message) throw new PaymentError('الصق نص رسالة التحويل.', 400, 'BAD_MESSAGE');
    const dev = (await d.pool.query(`INSERT INTO payment_devices(device_key,name,device_token_hash) VALUES('manual-paste','لصق يدوي من لوحة الإدارة',$1) ON CONFLICT(device_key) DO UPDATE SET last_seen_at=now() RETURNING id,enabled`, [crypto.randomBytes(32)])).rows[0];
    const r: any = await ingestSms(d.pool, { deviceId: dev.id, message, receivedAt: new Date().toISOString() });
    if (r.ignored) throw new PaymentError('هذا النص لا يبدو رسالة استلام من فودافون كاش أو أورنج كاش.', 422, 'NOT_WALLET_SMS');
    plog('SMS_MANUAL_PASTE', { staffId: req.principal.id, status: r.status || (r.duplicate ? 'DUPLICATE' : '') });
    await d.pool.query(`INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,metadata) VALUES('STAFF',$1,'payment.sms_pasted','payments',$2,$3)`, [req.principal.id, r.paymentId || null, { status: r.status || null, reason: r.reason || null, duplicate: Boolean(r.duplicate) }]);
    return r;
  });
  admin.get('/payment-devices', async (req: any) => { d.requirePermission(req, 'payments:read'); return (await d.pool.query('SELECT id,device_key,name,enabled,last_seen_at,last_sms_at,created_at FROM payment_devices ORDER BY created_at')).rows; });
  admin.post('/payment-devices', async (req: any) => {
    d.requirePermission(req, 'payments:write'); d.requireCsrf(req);
    const name = String(req.body?.name || '').trim().slice(0, 80); const key = String(req.body?.deviceKey || '').trim().toLowerCase();
    if (!name || !/^[a-z0-9-]{3,40}$/.test(key)) throw new PaymentError('اكتب اسمًا ومعرّف جهاز (حروف إنجليزية صغيرة وأرقام وشرطة).', 400, 'BAD_DEVICE');
    return createDevice(d.pool, name, key); // token is returned once and only stored hashed
  });
  admin.patch('/payment-devices/:id', async (req: any) => {
    d.requirePermission(req, 'payments:write'); d.requireCsrf(req);
    const r = await d.pool.query('UPDATE payment_devices SET enabled=$1,updated_at=now() WHERE id=$2 RETURNING id,device_key,name,enabled', [Boolean(req.body?.enabled), needUuid(req.params.id)]);
    if (!r.rowCount) throw new PaymentError('Not found', 404, 'NOT_FOUND');
    return r.rows[0];
  });
}

/* Machine endpoints: Android SMS device + Kashier webhook (no session, own authentication). */
/**
 * SMS input is deliberately tolerant so off-the-shelf automation apps (e.g. MacroDroid) work without custom code:
 *   - body: JSON {deviceId, message|text|body|sms, receivedAt|timestamp}, form-urlencoded, or the raw SMS as text/plain
 *   - token: `Authorization: Bearer <token>` or `X-Device-Token: <token>` (never in the URL — URLs end up in logs)
 */
export function smsInput(req: any) {
  const raw = req.body;
  const b: any = typeof raw === 'string' ? { message: raw } : raw && typeof raw === 'object' ? raw : {};
  const message = [b.message, b.text, b.body, b.sms, b.msg, b.content].find(v => typeof v === 'string' && v.trim());
  const ts = b.receivedAt ?? b.receivedStamp ?? b.timestamp ?? b.time;
  const receivedAt = ts == null || ts === '' ? new Date().toISOString() : /^\d{10,13}$/.test(String(ts)) ? new Date(Number(String(ts).padEnd(13, '0'))).toISOString() : String(ts);
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.headers['x-device-token'] || '') || undefined;
  return { message: message as string | undefined, receivedAt, token, deviceKey: String(b.deviceId || req.headers['x-device-id'] || '') };
}

export function registerPublicPaymentRoutes(app: FastifyInstance, d: Deps) {
  const bearer = (req: any) => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.headers['x-device-token'] || '') || undefined;
  // Form posts from automation apps (JSON and text/plain are parsed by Fastify itself).
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 16384 }, (_req, body, done) => { try { done(null, Object.fromEntries(new URLSearchParams(String(body)))); } catch (e: any) { done(e, undefined); } });
  app.post('/api/v1/payments/sms', { bodyLimit: 16384, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req: any) => {
    const input = smsInput(req);
    const device = await authenticateDevice(d.pool, input.token, input.deviceKey);
    plog('SMS_RECEIVED', { deviceId: device.id });
    if (!input.message) throw new PaymentError('message is required', 400, 'BAD_MESSAGE');
    return ingestSms(d.pool, { deviceId: device.id, message: input.message, receivedAt: input.receivedAt });
  });
  app.post('/api/v1/payments/devices/heartbeat', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req: any) => {
    const device = await authenticateDevice(d.pool, bearer(req), String(req.body?.deviceId || ''));
    return { ok: true, deviceId: device.device_key, serverTime: new Date().toISOString() };
  });
  app.post('/api/v1/payments/webhooks/kashier', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req: any) =>
    handleKashierWebhook(d.pool, { body: req.body, signature: req.headers['x-kashier-signature'] as string | undefined }));
}
