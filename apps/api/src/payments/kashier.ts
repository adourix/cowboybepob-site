import crypto from 'node:crypto';
import { formatMinor, parseMajorToMinor } from './money.js';

/**
 * Kashier Hosted Payment Page, per developers.kashier.io:
 *  - order hash: HMAC-SHA256 hex of `/?payment={mid}.{orderId}.{amount}.{currency}` keyed by the Payment API Key
 *  - webhook:   sort data.signatureKeys, take those keys from data, URL-encode as k=v&k=v,
 *               HMAC-SHA256 hex with the Payment API Key, compare to header `x-kashier-signature`
 */
export function kashierOrderHash(mid: string, orderId: string, amount: string, currency: string, apiKey: string) {
  return crypto.createHmac('sha256', apiKey).update(`/?payment=${mid}.${orderId}.${amount}.${currency}`).digest('hex');
}

export function buildKashierCheckoutUrl(o: { baseUrl: string; mid: string; apiKey: string; mode: 'test' | 'live'; orderId: string; amountMinor: number; currency: string; merchantRedirect: string; serverWebhook: string; display?: 'ar' | 'en'; description?: string }) {
  const amount = formatMinor(o.amountMinor);       // same string is signed and sent
  const hash = kashierOrderHash(o.mid, o.orderId, amount, o.currency, o.apiKey);
  const q = new URLSearchParams({
    merchantId: o.mid, orderId: o.orderId, amount, currency: o.currency, hash, mode: o.mode,
    merchantRedirect: o.merchantRedirect, serverWebhook: o.serverWebhook,
    allowedMethods: 'card', // Apple Pay is presented by Kashier on its card page when enabled on the merchant account
    failureRedirect: 'true', redirectMethod: 'get', display: o.display || 'ar', type: 'external',
    ...(o.description ? { description: o.description.slice(0, 119) } : {}),
  });
  return { url: `${o.baseUrl}/?${q.toString()}`, amount, hash };
}

/** PHP/Node reference implementations use querystring encoding of raw values. */
export function kashierWebhookSignature(data: Record<string, any>, apiKey: string) {
  const keys = Array.isArray(data?.signatureKeys) ? [...data.signatureKeys].map(String).sort() : [];
  const payload = keys.map(k => `${k}=${encodeURIComponent(data[k] == null ? '' : String(data[k]))}`).join('&');
  return crypto.createHmac('sha256', apiKey).update(payload).digest('hex');
}

export function verifyKashierWebhook(data: Record<string, any>, headerSignature: string | undefined, apiKey: string) {
  if (!apiKey || !headerSignature || !Array.isArray(data?.signatureKeys) || !data.signatureKeys.length) return false;
  const expected = Buffer.from(kashierWebhookSignature(data, apiKey), 'utf8');
  const given = Buffer.from(String(headerSignature).trim().toLowerCase(), 'utf8');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export type KashierEvent = {
  event: string; merchantOrderId: string; kashierOrderId: string | null; transactionId: string | null; status: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'UNKNOWN';
  method: 'CARD' | 'APPLE_PAY' | 'OTHER'; rawMethod: string; amountMinor: number | null; currency: string; merchantId: string | null; responseCode: string | null;
};
export function normalizeKashierEvent(body: any, amountUnit: 'major' | 'minor'): KashierEvent | null {
  const d = body?.data; if (!d || !d.merchantOrderId) return null;
  const rawMethod = String(d.method || d.paymentMethod?.type || '').toLowerCase();
  const brand = String(d.card?.cardInfo?.cardBrand || '').toLowerCase();
  const method = /apple/.test(rawMethod) || /apple/.test(brand) || /apple/.test(String(d.sourceOfFunds?.type || '').toLowerCase()) ? 'APPLE_PAY' : rawMethod === 'card' ? 'CARD' : 'OTHER';
  const st = String(d.status || '').toUpperCase();
  const amountMinor = amountUnit === 'minor' ? (Number.isInteger(Number(d.amount)) ? Number(d.amount) : null) : parseMajorToMinor(String(d.amount ?? ''));
  return {
    event: String(body.event || ''), merchantOrderId: String(d.merchantOrderId), kashierOrderId: d.kashierOrderId ? String(d.kashierOrderId) : null,
    transactionId: d.transactionId ? String(d.transactionId) : null, status: (['SUCCESS', 'FAILURE', 'PENDING'].includes(st) ? st : 'UNKNOWN') as KashierEvent['status'],
    method, rawMethod, amountMinor, currency: String(d.currency || '').toUpperCase(), merchantId: d.merchantId ? String(d.merchantId) : null,
    responseCode: d.transactionResponseCode != null ? String(d.transactionResponseCode) : null,
  };
}
