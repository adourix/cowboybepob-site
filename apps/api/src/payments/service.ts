import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { kashierConfigured, paymentConfig } from './config.js';
import { methodAvailability, PaymentMethod, PROVIDER_FOR } from './availability.js';
import { buildKashierCheckoutUrl, normalizeKashierEvent, verifyKashierWebhook } from './kashier.js';
import { matchSms, PendingPayment } from './matcher.js';
import { looksLikeWalletSms, normalizeWallet, parseWalletSms } from './vodafoneSms.js';

/**
 * PaymentService — the only module that changes payment state.
 * Orders know payment_method / payment_status / payment_id; provider logic stays here.
 *
 *   Vodafone Cash : AWAITING_TRANSFER → PENDING_VERIFICATION → AUTO_VERIFIED → PAID
 *                                                  ↘ EXPIRED      ↘ REVIEW_EXPIRED / REJECTED
 *   Kashier       : CREATED → CHECKOUT_STARTED → PROCESSING → PAID | FAILED | CANCELLED (| EXPIRED)
 */
export type Actor = { type: 'CUSTOMER' | 'STAFF' | 'SYSTEM' | 'DEVICE' | 'PROVIDER'; id?: string | null };
export const OPEN_STATUSES = ['AWAITING_TRANSFER', 'PENDING_VERIFICATION', 'CREATED', 'CHECKOUT_STARTED', 'PROCESSING'];
export class PaymentError extends Error { constructor(message: string, public statusCode = 400, public code = 'PAYMENT_ERROR') { super(message); } }

export function plog(event: string, fields: Record<string, any> = {}) {
  // Structured, no card data or raw SMS here.
  console.log(JSON.stringify({ level: 'info', scope: 'payments', event, at: new Date().toISOString(), ...fields }));
}

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}

async function transition(c: PoolClient, p: any, next: string, actor: Actor, reason: string | null, metadata: object = {}, set: Record<string, any> = {}) {
  const cols = Object.keys(set); const vals = Object.values(set);
  const extra = cols.map((k, i) => `${k}=$${i + 3}`).join(',');
  const row = (await c.query(`UPDATE payments SET status=$1,updated_at=now()${extra ? ',' + extra : ''} WHERE id=$2 RETURNING *`, [next, p.id, ...vals])).rows[0];
  await c.query('INSERT INTO payment_audit_logs(payment_id,actor_type,actor_id,previous_status,new_status,reason,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)', [p.id, actor.type, actor.id || null, p.status, next, reason, metadata]);
  await c.query('UPDATE orders SET payment_status=$1,payment_id=$2,payment_method=COALESCE($3,payment_method),updated_at=now() WHERE id=$4', [next, p.id, row.method, p.order_id]);
  return row;
}

async function enqueueFulfillment(c: PoolClient, orderId: string) {
  await c.query(`INSERT INTO jobs(type,key,subject_type,subject_id,payload) VALUES('fulfill_order',$1,'ORDER',$2,$3) ON CONFLICT(key) DO NOTHING`, [`fulfill:${orderId}`, orderId, JSON.stringify({ orderId })]);
}
async function orderHasRouter(c: PoolClient, orderId: string) {
  return Boolean((await c.query(`SELECT 1 FROM order_items WHERE order_id=$1 AND item_type='ROUTER' LIMIT 1`, [orderId])).rowCount);
}
async function setServicesActive(c: PoolClient, ids: string[], action: 'suspend' | 'resume') {
  for (const id of ids) {
    const next = action === 'suspend' ? 'SUSPENDED' : 'ACTIVE';
    const from = action === 'suspend' ? ['ACTIVE'] : ['SUSPENDED'];
    const r = await c.query(`UPDATE services SET status=$1,updated_at=now() WHERE id=$2 AND status=ANY($3::text[]) RETURNING id`, [next, id, from]);
    if (r.rowCount) await c.query(`INSERT INTO jobs(type,key,subject_type,subject_id,payload) VALUES('service_action',$1,'SERVICE',$2,$3) ON CONFLICT(key) DO NOTHING`, [`payment-${action}:${id}:${Date.now()}`, id, JSON.stringify({ action, reason: 'PAYMENT_REVIEW' })]);
  }
}
async function orderServiceIds(c: PoolClient, orderId: string): Promise<string[]> {
  return (await c.query(`SELECT s.id FROM services s JOIN order_items oi ON oi.id=s.origin_order_item_id WHERE oi.order_id=$1`, [orderId])).rows.map((r: any) => r.id);
}

/** Final success, common to every provider. */
async function markOrderPaid(c: PoolClient, p: any) {
  const o = (await c.query('SELECT id,status FROM orders WHERE id=$1 FOR UPDATE', [p.order_id])).rows[0];
  if (!o) return;
  await c.query(`UPDATE orders SET paid_at=COALESCE(paid_at,now()),updated_at=now() WHERE id=$1`, [o.id]);
  if (o.status === 'PENDING_PAYMENT' || o.status === 'PAYMENT_REJECTED') {
    await c.query(`UPDATE orders SET status='PAID',updated_at=now() WHERE id=$1`, [o.id]);
    await enqueueFulfillment(c, o.id);
  }
  const suspended: string[] = p.raw?.provisionalSuspendedServiceIds || [];
  if (suspended.length) await setServicesActive(c, suspended, 'resume');
}

/* ─────────────── availability ─────────────── */
export async function paymentOptions(pool: Pool, orderId: string, customerId: string) {
  const cfg = paymentConfig();
  const o = (await pool.query(`SELECT id,public_code,total_minor,currency,status,payment_status,payment_id FROM orders WHERE id=$1 AND customer_id=$2`, [orderId, customerId])).rows[0];
  if (!o) throw new PaymentError('Not found', 404, 'NOT_FOUND');
  const open = (await pool.query(`SELECT id,method,status,expires_at FROM payments WHERE order_id=$1 AND status=ANY($2::text[]) ORDER BY created_at DESC LIMIT 1`, [o.id, [...OPEN_STATUSES, 'AUTO_VERIFIED']])).rows[0] || null;
  return {
    orderId: o.id, orderCode: o.public_code, amountMinor: Number(o.total_minor), currency: o.currency, orderStatus: o.status,
    gatewayMinMinor: cfg.gatewayMinMinor, methods: methodAvailability(Number(o.total_minor), { gatewayMinMinor: cfg.gatewayMinMinor, kashierReady: kashierConfigured(cfg), vodafoneReady: cfg.vodafoneWallets.length > 0, orangeReady: cfg.orangeWallets.length > 0 }),
    openPayment: open,
  };
}

/* ─────────────── create ─────────────── */
export async function createPayment(pool: Pool, input: { orderId: string; customerId: string; method: PaymentMethod }) {
  const cfg = paymentConfig();
  return tx(pool, async c => {
    const o = (await c.query(`SELECT id,public_code,customer_id,total_minor,currency,status FROM orders WHERE id=$1 AND customer_id=$2 FOR UPDATE`, [input.orderId, input.customerId])).rows[0];
    if (!o) throw new PaymentError('Not found', 404, 'NOT_FOUND');
    if (o.status !== 'PENDING_PAYMENT') throw new PaymentError('هذا الطلب لا ينتظر الدفع.', 409, 'ORDER_NOT_PAYABLE');
    const amountMinor = Number(o.total_minor); // server-side amount only; anything the client sends is ignored
    const avail = methodAvailability(amountMinor, { gatewayMinMinor: cfg.gatewayMinMinor, kashierReady: kashierConfigured(cfg), vodafoneReady: cfg.vodafoneWallets.length > 0, orangeReady: cfg.orangeWallets.length > 0 }).find(m => m.method === input.method)!;
    if (!avail.available) {
      plog('PAYMENT_METHOD_REJECTED', { orderId: o.id, method: input.method, reason: avail.reason, amountMinor });
      throw new PaymentError(avail.reason === 'BELOW_GATEWAY_MINIMUM' ? `الدفع بالبطاقة أو Apple Pay متاح للطلبات من ${cfg.gatewayMinMinor / 100} جنيه فأكثر.` : 'طريقة الدفع غير متاحة حاليًا.', 422, avail.reason || 'METHOD_UNAVAILABLE');
    }
    const open = (await c.query(`SELECT * FROM payments WHERE order_id=$1 AND status=ANY($2::text[]) FOR UPDATE`, [o.id, [...OPEN_STATUSES, 'AUTO_VERIFIED']])).rows;
    for (const p of open) {
      if (['PENDING_VERIFICATION', 'PROCESSING', 'AUTO_VERIFIED'].includes(p.status)) throw new PaymentError('لديك دفعة قيد التحقق لهذا الطلب. انتظر نتيجة المراجعة.', 409, 'PAYMENT_IN_REVIEW');
      await transition(c, p, 'CANCELLED', { type: 'CUSTOMER', id: input.customerId }, 'REPLACED_BY_NEW_ATTEMPT');
    }
    const provider = PROVIDER_FOR[input.method];
    if (provider === 'MANUAL_WALLET') {
      // The customer is told exactly one wallet; it is stored on the payment so a later wallet change can't break matching.
      const wallet = input.method === 'ORANGE_CASH' ? cfg.orangeWallets[0] : cfg.vodafoneWallets[0];
      const p = (await c.query(`INSERT INTO payments(order_id,gateway,provider,method,amount_minor,currency,status,receiving_wallet,expires_at) VALUES($1,'manual','MANUAL_WALLET',$6,$2,$3,'AWAITING_TRANSFER',$4,now()+make_interval(mins=>$5)) RETURNING *`, [o.id, amountMinor, o.currency, wallet, cfg.paymentWindowMinutes, input.method])).rows[0];
      await c.query('INSERT INTO payment_audit_logs(payment_id,actor_type,actor_id,previous_status,new_status,reason) VALUES($1,$2,$3,NULL,$4,$5)', [p.id, 'CUSTOMER', input.customerId, p.status, 'PAYMENT_CREATED']);
      await c.query('UPDATE orders SET payment_method=$1,payment_status=$2,payment_id=$3,updated_at=now() WHERE id=$4', [p.method, p.status, p.id, o.id]);
      plog('PAYMENT_CREATED', { paymentId: p.id, orderId: o.id, provider, method: p.method, amountMinor });
      return { payment: publicPayment(p), action: { type: 'WALLET_INSTRUCTIONS', method: input.method, receivingWallet: wallet, amountMinor, orderCode: o.public_code, expiresAt: p.expires_at } };
    }
    const p = (await c.query(`INSERT INTO payments(order_id,gateway,provider,method,amount_minor,currency,status,expires_at) VALUES($1,'kashier','KASHIER',$2,$3,$4,'CREATED',now()+make_interval(mins=>$5)) RETURNING *`, [o.id, input.method, amountMinor, o.currency, cfg.kashier.checkoutTtlMinutes])).rows[0];
    await c.query('INSERT INTO payment_audit_logs(payment_id,actor_type,actor_id,previous_status,new_status,reason) VALUES($1,$2,$3,NULL,$4,$5)', [p.id, 'CUSTOMER', input.customerId, 'CREATED', 'PAYMENT_CREATED']);
    const checkout = buildKashierCheckoutUrl({
      baseUrl: cfg.kashier.checkoutUrl, mid: cfg.kashier.merchantId, apiKey: cfg.kashier.apiKey, mode: cfg.kashier.mode, orderId: p.id, amountMinor, currency: o.currency,
      merchantRedirect: `${cfg.publicAppUrl}/customer/payments/return?paymentId=${p.id}`, serverWebhook: `${cfg.publicApiUrl}/api/v1/payments/webhooks/kashier`, description: `CowboyBepob ${o.public_code}`,
    });
    const started = await transition(c, p, 'CHECKOUT_STARTED', { type: 'CUSTOMER', id: input.customerId }, 'KASHIER_CHECKOUT_CREATED', { amount: checkout.amount }, { provider_payment_id: p.id });
    plog('KASHIER_CHECKOUT_CREATED', { paymentId: p.id, orderId: o.id, method: input.method, amountMinor, mode: cfg.kashier.mode });
    return { payment: publicPayment(started), action: { type: 'REDIRECT', url: checkout.url } };
  });
}

/* ─────────────── Vodafone Cash: proof from customer ─────────────── */
const MAGIC: [string, number[], string][] = [['image/jpeg', [0xff, 0xd8, 0xff], 'jpg'], ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'png']];
export function sniffImage(buf: Buffer): { mime: string; ext: string } | null {
  for (const [mime, sig, ext] of MAGIC) if (sig.every((b, i) => buf[i] === b)) return { mime, ext };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}
export async function storeScreenshot(base64: string, declaredMime: string) {
  const cfg = paymentConfig();
  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw new PaymentError('صورة غير صالحة.', 400, 'BAD_IMAGE');
  const buf = Buffer.from(base64, 'base64');
  if (!buf.length || buf.length > cfg.maxScreenshotBytes) throw new PaymentError(`حجم الصورة يجب ألا يتجاوز ${Math.round(cfg.maxScreenshotBytes / 1048576)} ميجابايت.`, 413, 'IMAGE_TOO_LARGE');
  const kind = sniffImage(buf);
  if (!kind || (declaredMime && declaredMime !== kind.mime)) throw new PaymentError('الصيغ المسموحة: JPG أو PNG أو WebP.', 415, 'BAD_IMAGE_TYPE');
  const dir = path.resolve(cfg.uploadDir); await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const name = `${crypto.randomUUID()}.${kind.ext}`; // never the client's filename
  await fs.writeFile(path.join(dir, name), buf, { mode: 0o600, flag: 'wx' });
  return { name, mime: kind.mime, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}
export async function readScreenshot(name: string) {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name)) throw new PaymentError('Not found', 404, 'NOT_FOUND');
  return fs.readFile(path.join(path.resolve(paymentConfig().uploadDir), name));
}

export async function submitManualProof(pool: Pool, input: { paymentId: string; customerId: string; senderWallet: string; screenshot?: { base64: string; mime: string } }) {
  const cfg = paymentConfig();
  const wallet = normalizeWallet(input.senderWallet);
  if (!wallet) throw new PaymentError('رقم المحفظة غير صالح. اكتب رقم فودافون كاش الذي حوّلت منه، مثل 01012345678.', 400, 'BAD_WALLET');
  const shot = input.screenshot ? await storeScreenshot(input.screenshot.base64, input.screenshot.mime) : null;
  const result = await tx(pool, async c => {
    const p = (await c.query(`SELECT p.*,o.customer_id FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1 AND o.customer_id=$2 FOR UPDATE OF p`, [input.paymentId, input.customerId])).rows[0];
    if (!p) throw new PaymentError('Not found', 404, 'NOT_FOUND');
    if (p.provider !== 'MANUAL_WALLET') throw new PaymentError('هذه الدفعة ليست تحويل محفظة.', 409, 'WRONG_PROVIDER');
    if (!['AWAITING_TRANSFER', 'PENDING_VERIFICATION'].includes(p.status)) throw new PaymentError('لا يمكن تعديل بيانات هذه الدفعة الآن.', 409, 'NOT_EDITABLE');
    if (!shot && !p.screenshot_path) throw new PaymentError('ارفع صورة إيصال التحويل.', 400, 'SCREENSHOT_REQUIRED');
    const row = await transition(c, p, 'PENDING_VERIFICATION', { type: 'CUSTOMER', id: input.customerId }, 'PROOF_SUBMITTED', { screenshot: Boolean(shot) }, {
      customer_wallet: wallet, proof_submitted_at: new Date(),
      expires_at: new Date(Math.max(new Date(p.expires_at || Date.now()).getTime(), Date.now() + cfg.paymentWindowMinutes * 60000)),
      ...(shot ? { screenshot_path: shot.name, screenshot_mime: shot.mime, screenshot_sha256: shot.sha256 } : {}),
    });
    // Screenshot is only supporting evidence. Check SMS that may have arrived first.
    const smsRows = (await c.query(`SELECT * FROM payment_sms WHERE match_status='UNMATCHED' AND parse_status='PARSED' AND parsed_sender_wallet=$1 AND parsed_amount_minor=$2 AND received_at>now()-interval '3 days' ORDER BY parsed_transaction_time FOR UPDATE SKIP LOCKED`, [wallet, Number(p.amount_minor)])).rows;
    for (const s of smsRows) {
      const m = matchSms(smsFromRow(s), [pendingFromRow(row)], { skewMinutes: cfg.smsClockSkewMinutes });
      if (m.status === 'MATCHED') return autoVerify(c, row, s, m);
    }
    // No SMS yet: the customer finished paying, so the config runs until the accountant reviews it.
    const allowed = await mayActivateOnProof(c, row, input.customerId);
    if (!allowed.ok) { plog('PROVISIONAL_ACTIVATION_SKIPPED', { paymentId: row.id, reason: allowed.reason }); return row; }
    return provisionalActivate(c, row, 'PROOF_SUBMITTED');
  });
  plog('PAYMENT_PROOF_SUBMITTED', { paymentId: input.paymentId, status: result.status });
  return publicPayment(result);
}

/* ─────────────── Vodafone Cash: SMS from Android device ─────────────── */
const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest();
export async function authenticateDevice(pool: Pool, token: string | undefined, deviceKey: string) {
  if (!token || token.length < 24) throw new PaymentError('Unauthorized', 401, 'DEVICE_UNAUTHORIZED');
  const d = (await pool.query('SELECT * FROM payment_devices WHERE device_token_hash=$1', [sha256(token)])).rows[0];
  if (d) {
    if (!d.enabled) throw new PaymentError('Device disabled', 403, 'DEVICE_DISABLED');
    if (deviceKey && d.device_key !== deviceKey) throw new PaymentError('Unauthorized', 401, 'DEVICE_MISMATCH'); // optional: the token alone identifies the device
    await pool.query('UPDATE payment_devices SET last_seen_at=now() WHERE id=$1', [d.id]);
    return d;
  }
  const boot = paymentConfig().bootstrapDeviceToken;
  if (boot && boot.length >= 24 && crypto.timingSafeEqual(sha256(boot), sha256(token))) {
    const key = deviceKey || 'env-bootstrap';
    return (await pool.query(`INSERT INTO payment_devices(device_key,name,device_token_hash) VALUES($1,$1,$2) ON CONFLICT(device_token_hash) DO UPDATE SET last_seen_at=now() RETURNING *`, [key, sha256(token)])).rows[0];
  }
  throw new PaymentError('Unauthorized', 401, 'DEVICE_UNAUTHORIZED');
}
export async function createDevice(pool: Pool, name: string, deviceKey: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  const d = (await pool.query('INSERT INTO payment_devices(device_key,name,device_token_hash) VALUES($1,$2,$3) RETURNING id,device_key,name,enabled,created_at', [deviceKey, name, sha256(token)])).rows[0];
  return { device: d, token };
}

const smsFromRow = (s: any) => ({ ok: true as const, amountMinor: Number(s.parsed_amount_minor), senderWallet: s.parsed_sender_wallet, senderName: s.parsed_sender_name, receiverWallet: s.parsed_receiver_wallet, transactionTime: '', transactionDate: '', occurredAt: new Date(s.parsed_transaction_time), balanceMinor: null, reference: s.parsed_transaction_reference });
const pendingFromRow = (p: any): PendingPayment => ({ id: p.id, amountMinor: Number(p.amount_minor), customerWallet: p.customer_wallet, receivingWallet: p.receiving_wallet, createdAt: new Date(p.created_at), expiresAt: p.expires_at ? new Date(p.expires_at) : null });

/**
 * Business rule: the config runs while the accountant reviews (ACCOUNTANT_REVIEW_HOURS).
 * Never for orders containing a router. Returns the (possibly updated) payment row.
 */
async function provisionalActivate(c: PoolClient, p: any, why: 'SMS_MATCHED' | 'PROOF_SUBMITTED') {
  const cfg = paymentConfig();
  if (!cfg.provisionalActivation || await orderHasRouter(c, p.order_id)) return p;
  const o = (await c.query(`UPDATE orders SET status='PAID',updated_at=now() WHERE id=$1 AND status='PENDING_PAYMENT' RETURNING id`, [p.order_id])).rows[0];
  if (!o) return p;
  await enqueueFulfillment(c, p.order_id);
  const row = (await c.query(`UPDATE payments SET provisional_activation=true,review_expires_at=COALESCE(review_expires_at,now()+make_interval(hours=>$2)) WHERE id=$1 RETURNING *`, [p.id, cfg.reviewHours])).rows[0];
  await c.query('INSERT INTO payment_audit_logs(payment_id,actor_type,previous_status,new_status,reason) VALUES($1,$2,$3,$3,$4)', [p.id, 'SYSTEM', row.status, `PROVISIONAL_ACTIVATION:${why}`]);
  plog('PAYMENT_PROVISIONAL_ACTIVATION', { paymentId: p.id, orderId: p.order_id, why });
  return row;
}

/** Guards against free 24h service from fake receipts. */
async function mayActivateOnProof(c: PoolClient, p: any, customerId: string) {
  const cfg = paymentConfig();
  if (!cfg.activateOnProof) return { ok: false, reason: 'DISABLED' };
  const open = await c.query(`SELECT 1 FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.customer_id=$1 AND p.id<>$2 AND p.provisional_activation AND p.status IN ('PENDING_VERIFICATION','AUTO_VERIFIED') LIMIT 1`, [customerId, p.id]);
  if (open.rowCount) return { ok: false, reason: 'ANOTHER_PAYMENT_UNDER_REVIEW' };
  const bad = await c.query(`SELECT 1 FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.customer_id=$1 AND p.provider='MANUAL_WALLET' AND p.status IN ('REJECTED','REVIEW_EXPIRED') AND p.updated_at>now()-make_interval(days=>$2) LIMIT 1`, [customerId, cfg.proofActivationBlockDays]);
  if (bad.rowCount) return { ok: false, reason: 'RECENT_REJECTION' };
  return { ok: true, reason: null };
}

async function autoVerify(c: PoolClient, p: any, sms: any, m: any) {
  const cfg = paymentConfig();
  await c.query(`UPDATE payment_sms SET payment_id=$1,match_status='MATCHED',match_details=$2 WHERE id=$3`, [p.id, m, sms.id]);
  // Keep the deadline that started at proof time, if the config was already activated then.
  const row = await transition(c, p, 'AUTO_VERIFIED', { type: 'SYSTEM' }, 'SMS_MATCHED', { smsId: sms.id, reference: sms.parsed_transaction_reference }, {
    auto_verified_at: new Date(), review_expires_at: p.review_expires_at || new Date(Date.now() + cfg.reviewHours * 3600000), match_details: JSON.stringify(m), provider_reference: sms.parsed_transaction_reference,
  });
  plog('PAYMENT_AUTO_VERIFIED', { paymentId: p.id, orderId: p.order_id, smsId: sms.id });
  return provisionalActivate(c, row, 'SMS_MATCHED');
}

export async function ingestSms(pool: Pool, input: { deviceId: string; message: string; receivedAt: string }) {
  const cfg = paymentConfig();
  const message = String(input.message || '').slice(0, 2000);
  if (!looksLikeWalletSms(message)) { plog('SMS_IGNORED', { deviceId: input.deviceId }); return { accepted: false, ignored: true }; } // never store unrelated SMS
  const receivedAt = new Date(input.receivedAt); if (isNaN(receivedAt.getTime())) throw new PaymentError('receivedAt is invalid', 400, 'BAD_RECEIVED_AT');
  const hash = crypto.createHash('sha256').update(message.replace(/\s+/g, ' ').trim()).digest('hex');
  return tx(pool, async c => {
    await c.query('UPDATE payment_devices SET last_sms_at=now(),last_seen_at=now() WHERE id=$1', [input.deviceId]);
    const parsed = parseWalletSms(message, { receivedAt, orangeWallet: cfg.orangeWallets[0] || null });
    let matchStatus = parsed.ok ? 'UNMATCHED' : 'MANUAL_REVIEW';
    if (parsed.ok && parsed.reference) {
      const dup = await c.query(`SELECT id FROM payment_sms WHERE parsed_transaction_reference=$1 AND match_status<>'DUPLICATE' LIMIT 1`, [parsed.reference]);
      if (dup.rowCount) matchStatus = 'DUPLICATE';
    }
    const ins = await c.query(`INSERT INTO payment_sms(device_id,raw_message,message_hash,parse_status,parse_error,parsed_amount_minor,parsed_sender_wallet,parsed_sender_name,parsed_receiver_wallet,parsed_transaction_reference,parsed_transaction_time,parsed_balance_minor,match_status,received_at,carrier)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(message_hash) DO NOTHING RETURNING *`,
      [input.deviceId, message, hash, parsed.ok ? 'PARSED' : 'FAILED', parsed.ok ? null : parsed.reason, parsed.ok ? parsed.amountMinor : null, parsed.ok ? parsed.senderWallet : null, parsed.ok ? parsed.senderName : null, parsed.ok ? parsed.receiverWallet : null, parsed.ok ? parsed.reference : null, parsed.ok ? parsed.occurredAt : null, parsed.ok ? parsed.balanceMinor : null, matchStatus, receivedAt, parsed.ok ? (parsed.carrier || 'VODAFONE') : null]);
    if (!ins.rowCount) { plog('SMS_DUPLICATE', { deviceId: input.deviceId }); return { accepted: true, duplicate: true }; }
    const sms = ins.rows[0];
    plog(parsed.ok ? 'SMS_PARSED' : 'SMS_PARSE_FAILED', { smsId: sms.id, reason: parsed.ok ? undefined : parsed.reason });
    if (!parsed.ok) return { accepted: true, status: 'MANUAL_REVIEW' };
    if (matchStatus === 'DUPLICATE') { plog('PAYMENT_DUPLICATE_DETECTED', { smsId: sms.id, reference: parsed.reference }); return { accepted: true, status: 'DUPLICATE' }; }
    if (cfg.receivingWallets.length && !cfg.receivingWallets.includes(parsed.receiverWallet)) {
      await c.query(`UPDATE payment_sms SET match_details=$1 WHERE id=$2`, [{ reason: 'RECEIVER_NOT_OURS' }, sms.id]);
      return { accepted: true, status: 'UNMATCHED', reason: 'RECEIVER_NOT_OURS' };
    }
    const cands = (await c.query(`SELECT * FROM payments WHERE provider='MANUAL_WALLET' AND status='PENDING_VERIFICATION' AND customer_wallet=$1 ORDER BY created_at FOR UPDATE SKIP LOCKED`, [parsed.senderWallet])).rows;
    const m = matchSms(parsed, cands.map(pendingFromRow), { skewMinutes: cfg.smsClockSkewMinutes });
    if (m.status !== 'MATCHED') { await c.query(`UPDATE payment_sms SET match_details=$1 WHERE id=$2`, [m, sms.id]); return { accepted: true, status: 'UNMATCHED', reason: m.reason }; }
    const p = cands.find((x: any) => x.id === m.paymentId);
    await autoVerify(c, p, sms, m);
    return { accepted: true, status: 'MATCHED', paymentId: p.id };
  });
}

/* ─────────────── accountant ─────────────── */
export async function confirmPayment(pool: Pool, input: { paymentId: string; staffId: string; reason?: string }) {
  return tx(pool, async c => {
    const p = (await c.query(`SELECT p.*,o.total_minor,o.status order_status FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1 FOR UPDATE OF p`, [input.paymentId])).rows[0];
    if (!p) throw new PaymentError('الدفعة غير موجودة', 404, 'NOT_FOUND');
    if (p.status === 'PAID') return p;
    if (p.provider === 'KASHIER') throw new PaymentError('دفعات Kashier تتأكد تلقائيًا من الـWebhook فقط.', 409, 'PROVIDER_VERIFIED_ONLY');
    if (!['AUTO_VERIFIED', 'PENDING_VERIFICATION', 'REVIEW_EXPIRED', 'INITIATED', 'PENDING'].includes(p.status)) throw new PaymentError('لا يمكن تأكيد هذه الدفعة في حالتها الحالية', 409, 'BAD_STATE');
    const reason = String(input.reason || '').trim().slice(0, 500);
    if (p.status === 'REVIEW_EXPIRED' && reason.length < 3) throw new PaymentError('انتهت مهلة المراجعة لهذه الدفعة. اكتب سبب التأكيد.', 400, 'REASON_REQUIRED');
    if (Number(p.amount_minor) !== Number(p.total_minor)) throw new PaymentError('مبلغ الدفعة لا يطابق إجمالي الطلب', 409, 'AMOUNT_MISMATCH');
    if (p.order_status === 'CANCELLED') throw new PaymentError('لا يمكن تأكيد دفع طلب ملغى', 409, 'ORDER_CANCELLED');
    const row = await transition(c, p, 'PAID', { type: 'STAFF', id: input.staffId }, reason || (p.status === 'AUTO_VERIFIED' ? 'ACCOUNTANT_CONFIRMED' : 'ACCOUNTANT_CONFIRMED_WITHOUT_SMS'), { fromAutoVerified: p.status === 'AUTO_VERIFIED', smsMatched: p.status === 'AUTO_VERIFIED' }, { verified_at: new Date(), paid_at: new Date(), recorded_by_staff_id: input.staffId });
    await markOrderPaid(c, row);
    plog('PAYMENT_CONFIRMED', { paymentId: p.id, staffId: input.staffId, manual: p.status !== 'AUTO_VERIFIED' });
    return row;
  });
}

export async function rejectPayment(pool: Pool, input: { paymentId: string; staffId: string; reason: string }) {
  return tx(pool, async c => {
    const p = (await c.query(`SELECT * FROM payments WHERE id=$1 FOR UPDATE`, [input.paymentId])).rows[0];
    if (!p) throw new PaymentError('الدفعة غير موجودة', 404, 'NOT_FOUND');
    if (p.status === 'REJECTED') return p;
    if (p.provider === 'KASHIER') throw new PaymentError('دفعات Kashier لا تُرفض يدويًا؛ استخدم الاسترداد من لوحة Kashier.', 409, 'PROVIDER_VERIFIED_ONLY');
    if (!['AUTO_VERIFIED', 'PENDING_VERIFICATION', 'REVIEW_EXPIRED', 'AWAITING_TRANSFER', 'INITIATED', 'PENDING'].includes(p.status)) throw new PaymentError('لا يمكن رفض هذه الدفعة في حالتها الحالية', 409, 'BAD_STATE');
    const reason = String(input.reason || '').trim().slice(0, 500) || 'ACCOUNTANT_REJECTED';
    const row = await transition(c, p, 'REJECTED', { type: 'STAFF', id: input.staffId }, reason, {}, { recorded_by_staff_id: input.staffId });
    await afterLoss(c, row, 'PAYMENT_REJECTED');
    plog('PAYMENT_REJECTED', { paymentId: p.id, staffId: input.staffId });
    return row;
  });
}

/** Payment did not hold: switch provisional services off, or let the customer retry. */
async function afterLoss(c: PoolClient, p: any, orderStatusIfActivated: string) {
  if (p.provisional_activation) {
    const ids = await orderServiceIds(c, p.order_id);
    await setServicesActive(c, ids, 'suspend');
    await c.query(`UPDATE payments SET raw=COALESCE(raw,'{}'::jsonb)||jsonb_build_object('provisionalSuspendedServiceIds',$1::jsonb) WHERE id=$2`, [JSON.stringify(ids), p.id]);
    await c.query(`UPDATE orders SET status=$1,updated_at=now() WHERE id=$2 AND status IN ('PAID','FULFILLING','COMPLETED')`, [orderStatusIfActivated, p.order_id]);
  }
}

/* ─────────────── timers (worker) ─────────────── */
export async function paymentSweep(pool: Pool) {
  const cfg = paymentConfig(); let n = 0;
  const run = async (sql: string, args: any[], next: string, reason: string, after?: (c: PoolClient, row: any) => Promise<void>) => {
    await tx(pool, async c => {
      for (const p of (await c.query(sql + ' FOR UPDATE SKIP LOCKED', args)).rows) {
        const row = await transition(c, p, next, { type: 'SYSTEM' }, reason); if (after) await after(c, row); n++;
        plog(next === 'REVIEW_EXPIRED' ? 'PAYMENT_REVIEW_EXPIRED' : 'PAYMENT_EXPIRED', { paymentId: p.id });
      }
    });
  };
  await run(`SELECT * FROM payments WHERE status='AWAITING_TRANSFER' AND expires_at<now()`, [], 'EXPIRED', 'TRANSFER_WINDOW_PASSED');
  await run(`SELECT * FROM payments WHERE status='PENDING_VERIFICATION' AND provisional_activation AND review_expires_at<now()`, [], 'REVIEW_EXPIRED', 'ACCOUNTANT_REVIEW_WINDOW_PASSED', (c, row) => afterLoss(c, row, 'PAYMENT_REVIEW'));
  await run(`SELECT * FROM payments WHERE status='PENDING_VERIFICATION' AND NOT provisional_activation AND expires_at<now()-make_interval(hours=>$1)`, [cfg.reviewHours], 'EXPIRED', 'NO_MATCHING_SMS');
  await run(`SELECT * FROM payments WHERE status='AUTO_VERIFIED' AND review_expires_at<now()`, [], 'REVIEW_EXPIRED', 'ACCOUNTANT_REVIEW_WINDOW_PASSED', (c, row) => afterLoss(c, row, 'PAYMENT_REVIEW'));
  await run(`SELECT * FROM payments WHERE provider='KASHIER' AND status IN ('CREATED','CHECKOUT_STARTED') AND expires_at<now()`, [], 'EXPIRED', 'CHECKOUT_ABANDONED');
  return n;
}

/* ─────────────── Kashier webhook ─────────────── */
export async function handleKashierWebhook(pool: Pool, input: { body: any; signature: string | undefined }) {
  const cfg = paymentConfig();
  const data = input.body?.data;
  if (!verifyKashierWebhook(data || {}, input.signature, cfg.kashier.apiKey)) { plog('KASHIER_WEBHOOK_INVALID_SIGNATURE', {}); throw new PaymentError('Invalid signature', 401, 'BAD_SIGNATURE'); }
  const ev = normalizeKashierEvent(input.body, cfg.kashier.webhookAmountUnit);
  if (!ev) throw new PaymentError('Malformed event', 400, 'MALFORMED');
  plog('KASHIER_WEBHOOK_RECEIVED', { event: ev.event, status: ev.status, merchantOrderId: ev.merchantOrderId, transactionId: ev.transactionId });
  const eventId = `${ev.transactionId || ev.kashierOrderId || ev.merchantOrderId}:${ev.event}:${ev.status}`;
  // Only safe, normalized fields are stored; masked card data is dropped.
  const safe = { event: ev.event, status: ev.status, method: ev.rawMethod, amount: data.amount, currency: ev.currency, merchantOrderId: ev.merchantOrderId, kashierOrderId: ev.kashierOrderId, transactionId: ev.transactionId, responseCode: ev.responseCode };
  return tx(pool, async c => {
    const e = await c.query(`INSERT INTO payment_events(gateway,event_id,payload) VALUES('kashier',$1,$2) ON CONFLICT(gateway,event_id) DO NOTHING RETURNING id`, [eventId, safe]);
    if (!e.rowCount) return { ok: true, duplicate: true };
    const done = async (result: string, paymentId: string | null = null) => { await c.query(`UPDATE payment_events SET result=$1,payment_id=$2,processed_at=now() WHERE id=$3`, [result, paymentId, e.rows[0].id]); return { ok: true, result }; };
    if (!/^[0-9a-f-]{36}$/i.test(ev.merchantOrderId)) return done('UNKNOWN_PAYMENT');
    const p = (await c.query(`SELECT p.*,o.total_minor,o.currency order_currency FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1 AND p.provider='KASHIER' FOR UPDATE OF p`, [ev.merchantOrderId])).rows[0];
    if (!p) return done('UNKNOWN_PAYMENT');
    if (ev.merchantId && ev.merchantId !== cfg.kashier.merchantId) { plog('KASHIER_PAYMENT_FAILED', { paymentId: p.id, reason: 'MERCHANT_MISMATCH' }); return done('MERCHANT_MISMATCH', p.id); }
    await c.query(`UPDATE payments SET webhook_received_at=now(),provider_status=$1 WHERE id=$2`, [ev.status, p.id]);
    if (p.status === 'PAID') return done('ALREADY_PAID', p.id);
    if (ev.status === 'SUCCESS' && ['pay', 'capture', ''].includes(ev.event)) {
      if (ev.currency !== String(p.currency).trim()) { await c.query(`UPDATE payments SET webhook_status='CURRENCY_MISMATCH' WHERE id=$1`, [p.id]); plog('KASHIER_PAYMENT_FAILED', { paymentId: p.id, reason: 'CURRENCY_MISMATCH' }); return done('CURRENCY_MISMATCH', p.id); }
      if (ev.amountMinor == null || ev.amountMinor !== Number(p.amount_minor) || ev.amountMinor !== Number(p.total_minor)) { await c.query(`UPDATE payments SET webhook_status='AMOUNT_MISMATCH' WHERE id=$1`, [p.id]); plog('KASHIER_PAYMENT_FAILED', { paymentId: p.id, reason: 'AMOUNT_MISMATCH', expected: Number(p.amount_minor), received: ev.amountMinor }); return done('AMOUNT_MISMATCH', p.id); }
      const method = ev.method === 'APPLE_PAY' ? 'APPLE_PAY' : ev.method === 'CARD' ? 'CARD' : p.method;
      const row = await transition(c, p, 'PAID', { type: 'PROVIDER', id: null }, 'KASHIER_WEBHOOK_VERIFIED', { transactionId: ev.transactionId, method: ev.rawMethod }, {
        method, provider_reference: ev.transactionId, gateway_txn_id: ev.transactionId, verified_at: new Date(), paid_at: new Date(), webhook_status: 'VERIFIED', raw: JSON.stringify({ kashierOrderId: ev.kashierOrderId }),
      });
      await markOrderPaid(c, row);
      plog('KASHIER_PAYMENT_VERIFIED', { paymentId: p.id, orderId: p.order_id, method });
      return done('PAID', p.id);
    }
    if (ev.status === 'PENDING') { if (['CREATED', 'CHECKOUT_STARTED', 'EXPIRED'].includes(p.status)) await transition(c, p, 'PROCESSING', { type: 'PROVIDER' }, 'KASHIER_PENDING'); return done('PROCESSING', p.id); }
    const cancelled = ['void', 'reject', 'reversal'].includes(ev.event);
    if (ev.status === 'FAILURE' || cancelled) {
      await transition(c, p, cancelled ? 'CANCELLED' : 'FAILED', { type: 'PROVIDER' }, cancelled ? `KASHIER_${ev.event.toUpperCase()}` : 'KASHIER_FAILURE', { responseCode: ev.responseCode }, { webhook_status: 'VERIFIED' });
      plog('KASHIER_PAYMENT_FAILED', { paymentId: p.id, reason: cancelled ? ev.event : 'FAILURE' });
      return done(cancelled ? 'CANCELLED' : 'FAILED', p.id);
    }
    return done('IGNORED', p.id);
  });
}

/* ─────────────── read models ─────────────── */
export function publicPayment(p: any) {
  // Customer-safe: no raw SMS, no screenshot path, no match internals.
  return { id: p.id, orderId: p.order_id, provider: p.provider, method: p.method, status: p.status, amountMinor: Number(p.amount_minor), currency: p.currency, receivingWallet: p.provider === 'MANUAL_WALLET' ? p.receiving_wallet : undefined, customerWallet: p.customer_wallet || null, hasScreenshot: Boolean(p.screenshot_path), provisionalActivation: Boolean(p.provisional_activation), expiresAt: p.expires_at, reviewExpiresAt: p.review_expires_at, verifiedAt: p.verified_at, createdAt: p.created_at };
}
export async function getCustomerPayment(pool: Pool, paymentId: string, customerId: string) {
  const p = (await pool.query(`SELECT p.*,o.public_code order_code FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1 AND o.customer_id=$2`, [paymentId, customerId])).rows[0];
  if (!p) throw new PaymentError('Not found', 404, 'NOT_FOUND');
  return { ...publicPayment(p), orderCode: p.order_code };
}
