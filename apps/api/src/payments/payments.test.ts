import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { formatMinor, normalizeDigits, parseMajorToMinor } from './money.js';
import { cairoToUtc, looksLikeWalletSms, normalizeWallet, parseOrangeCashSms, parseVodafoneCashSms, parseWalletSms } from './vodafoneSms.js';
import { matchSms, PendingPayment } from './matcher.js';
import { buildKashierCheckoutUrl, kashierOrderHash, kashierWebhookSignature, normalizeKashierEvent, verifyKashierWebhook } from './kashier.js';
import { methodAvailability } from './availability.js';

const SAMPLE = `تم استلام مبلغ 165.00 جنيه من 01275555667؛
المسجل بإسم ABDELRAHMAN IBRAHIM SHEHAB AYAD
على رقم محفظتك 01044577552 بتاريخ 18:47 26-10-16.
رصيدك الحالي: 2509.88 جنيه
رقم العملية: 024786200222
تقدر تتابع كل مصروفاتك من تاريخ المعاملات على أبلكيشن أنا فودافون http://vf.eg/vfcash`;
const toArabicDigits = (s: string) => s.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

describe('money (integer piasters only)', () => {
  it('parses and formats without floats', () => {
    expect(parseMajorToMinor('165.00')).toBe(16500);
    expect(parseMajorToMinor('75')).toBe(7500);
    expect(parseMajorToMinor('1,250.5')).toBe(125050);
    expect(parseMajorToMinor('١٦٥٫٠٠')).toBe(16500);
    expect(parseMajorToMinor('0.1')).toBe(10);
    expect(parseMajorToMinor('12.345')).toBeNull();
    expect(parseMajorToMinor('abc')).toBeNull();
    expect(formatMinor(7500)).toBe('75.00');
    expect(formatMinor(1)).toBe('0.01');
    expect(normalizeDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });
});

describe('Vodafone Cash SMS parser', () => {
  it('parses the real sample (English digits) — test 15', () => {
    const r = parseVodafoneCashSms(SAMPLE);
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.amountMinor).toBe(16500);
    expect(r.senderWallet).toBe('01275555667');
    expect(r.receiverWallet).toBe('01044577552');
    expect(r.senderName).toBe('ABDELRAHMAN IBRAHIM SHEHAB AYAD');
    expect(r.transactionTime).toBe('18:47');
    expect(r.transactionDate).toBe('2026-10-16');
    expect(r.balanceMinor).toBe(250988);
    expect(r.reference).toBe('024786200222');
    expect(r.occurredAt.toISOString()).toBe('2026-10-16T15:47:00.000Z'); // Cairo is UTC+3 (DST) on that date
  });
  it('parses Arabic-Indic digits — test 14', () => {
    const r = parseVodafoneCashSms(toArabicDigits(SAMPLE).replace('vf.eg/vfcash', 'vf.eg/vfcash'));
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.amountMinor).toBe(16500); expect(r.senderWallet).toBe('01275555667'); expect(r.reference).toBe('024786200222');
  });
  it('rejects malformed SMS safely — test 16', () => {
    const noAmount = parseVodafoneCashSms('تم استلام مبلغ جنيه من 01275555667 على رقم محفظتك 01044577552 بتاريخ 18:47 26-10-16');
    expect(noAmount).toMatchObject({ ok: false, reason: 'AMOUNT_NOT_FOUND', looksLikeVodafoneCash: true });
    const badDate = parseVodafoneCashSms('تم استلام مبلغ 10.00 جنيه من 01275555667؛ على رقم محفظتك 01044577552 بتاريخ 25:99 26-13-40');
    expect(badDate.ok).toBe(false);
    expect(parseVodafoneCashSms('موعدك مع الطبيب غدا الساعة 5')).toMatchObject({ ok: false, looksLikeVodafoneCash: false });
  });
  it('normalizes wallets in every common format', () => {
    for (const w of ['01275555667', '+201275555667', '00201275555667', '201275555667', '٠١٢٧٥٥٥٥٦٦٧']) expect(normalizeWallet(w)).toBe('01275555667');
    expect(normalizeWallet('0127555')).toBeNull();
    expect(normalizeWallet('01375555667')).toBeNull();
  });
  it('converts Cairo wall-clock across DST', () => {
    expect(cairoToUtc(2026, 1, 10, 12, 0).toISOString()).toBe('2026-01-10T10:00:00.000Z'); // winter UTC+2
    expect(cairoToUtc(2026, 7, 10, 12, 0).toISOString()).toBe('2026-07-10T09:00:00.000Z'); // summer UTC+3
  });
});

describe('matching engine', () => {
  const sms = parseVodafoneCashSms(SAMPLE); if (!sms.ok) throw new Error('fixture');
  const at = (iso: string) => new Date(iso);
  const pay = (o: Partial<PendingPayment> = {}): PendingPayment => ({ id: o.id || 'p1', amountMinor: 16500, customerWallet: '01275555667', receivingWallet: '01044577552', createdAt: at('2026-10-16T15:40:00Z'), expiresAt: at('2026-10-16T16:10:00Z'), ...o });
  const opts = { skewMinutes: 5 };
  it('correct SMS matches — test 7', () => { expect(matchSms(sms, [pay()], opts)).toMatchObject({ status: 'MATCHED', paymentId: 'p1' }); });
  it('wrong amount — test 8', () => { expect(matchSms(sms, [pay({ amountMinor: 16000 })], opts)).toMatchObject({ status: 'UNMATCHED', reason: 'AMOUNT_MISMATCH' }); });
  it('wrong sender — test 9', () => { expect(matchSms(sms, [pay({ customerWallet: '01099999999' })], opts)).toMatchObject({ status: 'UNMATCHED', reason: 'SENDER_MISMATCH' }); });
  it('wrong receiver — test 10', () => { expect(matchSms(sms, [pay({ receivingWallet: '01000000000' })], opts)).toMatchObject({ status: 'UNMATCHED', reason: 'RECEIVER_MISMATCH' }); });
  it('old transaction outside the window — test 11', () => {
    expect(matchSms(sms, [pay({ createdAt: at('2026-10-16T17:00:00Z'), expiresAt: at('2026-10-16T17:30:00Z') })], opts)).toMatchObject({ status: 'UNMATCHED', reason: 'OUTSIDE_PAYMENT_WINDOW' });
  });
  it('multiple identical orders: oldest first, the rest wait — test 19', () => {
    const r = matchSms(sms, [pay({ id: 'newer', createdAt: at('2026-10-16T15:45:00Z') }), pay({ id: 'older', createdAt: at('2026-10-16T15:41:00Z') })], opts);
    expect(r).toMatchObject({ status: 'MATCHED', paymentId: 'older', alsoMatching: ['newer'] });
  });
  it('no open payments', () => { expect(matchSms(sms, [], opts)).toMatchObject({ status: 'UNMATCHED', reason: 'NO_OPEN_PAYMENTS' }); });
});

describe('payment method availability (75 EGP rule) — tests 1-3', () => {
  const o = { gatewayMinMinor: 7500, kashierReady: true, vodafoneReady: true };
  const avail = (amt: number) => Object.fromEntries(methodAvailability(amt, o).map(m => [m.method, m.available]));
  it('below 75 EGP: Vodafone Cash only', () => expect(avail(7499)).toEqual({ VODAFONE_CASH: true, CARD: false, APPLE_PAY: false }));
  it('exactly 75 EGP: card + Apple Pay allowed', () => expect(avail(7500)).toEqual({ VODAFONE_CASH: true, CARD: true, APPLE_PAY: true }));
  it('gateway not configured → card hidden with reason', () => {
    expect(methodAvailability(10000, { ...o, kashierReady: false }).find(m => m.method === 'CARD')).toMatchObject({ available: false, reason: 'GATEWAY_NOT_CONFIGURED' });
  });
});

describe('Kashier (official algorithms)', () => {
  it('order hash matches the published test vector', () => {
    expect(kashierOrderHash('mid-0-1', '99', '20', 'EGP', '11111')).toBe('606a8a1307d64caf4e2e9bb724738f115a8972c27eccb2a8acd9194c357e4bec');
  });
  it('checkout URL signs exactly the server amount — tests 4-5', () => {
    const r = buildKashierCheckoutUrl({ baseUrl: 'https://checkout.kashier.io', mid: 'MID-1-1', apiKey: 'k', mode: 'test', orderId: 'pay-1', amountMinor: 16500, currency: 'EGP', merchantRedirect: 'https://x/r', serverWebhook: 'https://x/w' });
    const u = new URL(r.url);
    expect(u.searchParams.get('amount')).toBe('165.00');
    expect(u.searchParams.get('hash')).toBe(kashierOrderHash('MID-1-1', 'pay-1', '165.00', 'EGP', 'k'));
    expect(u.searchParams.get('mode')).toBe('test');
  });
  const data = { merchantOrderId: '0b6c5d3e-1111-4222-8333-444455556666', kashierOrderId: 'k-1', orderReference: 'TEST-ORD-1', transactionId: 'TX-1', status: 'SUCCESS', method: 'card', amount: '165.00', currency: 'EGP', channel: 'online', transactionResponseCode: '00', signatureKeys: ['status', 'amount', 'currency', 'merchantOrderId', 'method', 'transactionId', 'kashierOrderId', 'orderReference', 'channel', 'transactionResponseCode'] };
  const signed = (d: any, key = 'secret-key') => kashierWebhookSignature(d, key);
  it('valid webhook signature accepted — test 23', () => expect(verifyKashierWebhook(data, signed(data), 'secret-key')).toBe(true));
  it('tampered amount / wrong key / missing header rejected — tests 24, 36', () => {
    expect(verifyKashierWebhook({ ...data, amount: '1.00' }, signed(data), 'secret-key')).toBe(false);
    expect(verifyKashierWebhook(data, signed(data, 'other'), 'secret-key')).toBe(false);
    expect(verifyKashierWebhook(data, undefined, 'secret-key')).toBe(false);
  });
  it('signature payload = sorted keys, URL-encoded values', () => {
    const d = { b: 'x y', a: '1', signatureKeys: ['b', 'a'] };
    expect(kashierWebhookSignature(d, 'k')).toBe(crypto.createHmac('sha256', 'k').update('a=1&b=x%20y').digest('hex'));
  });
  it('records card vs Apple Pay — tests 30-31', () => {
    expect(normalizeKashierEvent({ event: 'pay', data }, 'major')).toMatchObject({ method: 'CARD', amountMinor: 16500, status: 'SUCCESS', transactionId: 'TX-1' });
    expect(normalizeKashierEvent({ event: 'pay', data: { ...data, method: 'apple_pay' } }, 'major')?.method).toBe('APPLE_PAY');
    expect(normalizeKashierEvent({ event: 'pay', data: { ...data, amount: 16500 } }, 'minor')?.amountMinor).toBe(16500);
  });
});

describe('Orange Cash SMS (no receiver, no date in the message)', () => {
  const ORANGE = 'لقد استقبلت تحويل أموال بمبلغ 5.00 جنيه من 00201009823007رصيد اورنچ كاش الجديد 15.20 جنيه رقم المعاملة 25000247335451';
  const at = new Date('2026-10-20T12:30:00Z');
  it('parses the real sample (digits glued to "رصيد")', () => {
    const r = parseOrangeCashSms(ORANGE, { receivedAt: at, ourWallet: '01200000001' });
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r).toMatchObject({ carrier: 'ORANGE', amountMinor: 500, senderWallet: '01009823007', receiverWallet: '01200000001', balanceMinor: 1520, reference: '25000247335451', receiverFromConfig: true, timeFromReceipt: true });
    expect(r.occurredAt.toISOString()).toBe(at.toISOString());
    expect(r.transactionTime).toBe('15:30'); // Cairo (UTC+3 in October)
  });
  it('dispatcher picks the right format', () => {
    expect((parseWalletSms(ORANGE, { receivedAt: at, orangeWallet: '01200000001' }) as any).carrier).toBe('ORANGE');
    const vf = 'تم استلام مبلغ 10.00 جنيه من 01275555667؛ على رقم محفظتك 01044577552 بتاريخ 18:47 26-10-16. رقم العملية: 1234567';
    expect((parseWalletSms(vf, { receivedAt: at, orangeWallet: '01200000001' }) as any).carrier).toBe('VODAFONE');
  });
  it('Arabic-Indic digits and أورنج spelling', () => {
    const ar = ORANGE.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]).replace('اورنچ', 'أورنج');
    const r = parseOrangeCashSms(ar, { receivedAt: at, ourWallet: '01200000001' });
    expect(r.ok && r.amountMinor === 500 && r.senderWallet === '01009823007' && r.reference === '25000247335451').toBe(true);
  });
  it('never guesses the receiver when no Orange wallet is configured (parsed, receiver null)', () => {
    const r = parseOrangeCashSms(ORANGE, { receivedAt: at, ourWallet: null });
    expect(r).toMatchObject({ ok: true, receiverWallet: null, receiverFromConfig: false, amountMinor: 500 });
  });
  it('recognised as a wallet receipt (stored), unrelated SMS still refused', () => {
    expect(looksLikeWalletSms(ORANGE)).toBe(true);
    expect(looksLikeWalletSms('عرض خاص من أورنج: باقة جديدة')).toBe(false);
  });
});

/* ─────────────── Regression: the four real production SMS (every field verified) ─────────────── */
import { extractWalletReceipt } from './vodafoneSms.js';
describe('real wallet SMS — exact production messages', () => {
  const RECEIVED = new Date('2026-10-20T08:15:00Z'); // 11:15 Cairo
  const ORANGE_WALLET = '01200000001';             // stands in for ORANGE_CASH_RECEIVING_WALLET
  const parse = (m: string, wallet: string | null = ORANGE_WALLET) => { const r = parseWalletSms(m, { receivedAt: RECEIVED, orangeWallet: wallet }); if (!r.ok) throw new Error(`parse failed: ${r.reason}`); return r; };

  const M1 = `تم استلام مبلغ 2500 جنيه من رقم 01012208430 المسجل بإسم Alhussien R Kassem على رقم محفظتك  01044577552.
رصيدك الحالي: 2500.17 جنيه
تاريخ العملية: 12:46 26-10-14
رقم العملية: 024703283984
تابع كل مصروفاتك من تاريخ المعاملات على أبلكيشن أنا فودافون http://vf.eg/vfcash`;
  const M2 = `تم استلام مبلغ 80.00 جنيه من 01275555667؛
المسجل بإسم ABDELRAHMAN IBRAHIM SHEHAB AYAD
على رقم محفظتك 01044577552 بتاريخ 02:09 26-10-20.
رصيدك الحالي: 2508.88 جنيه
رقم العملية: 024901397476
 تقدر تتابع كل مصروفاتك من تاريخ المعاملات على أبلكيشن أنا فودافون http://vf.eg/vfcash`;
  const M3 = `تم استلام مبلغ 5005.00 جنيه من Mohamed N Ewedah، رصيدك الحالي 5005.20 جنية، رقم المعاملة 25000222476561.

عرض مايتفوتش!
وفّر 540 جنيه على اشتراك Yango Play واتفرج على اجمد الافلام والمسلسلات في مصر
خصم 65% على اشتراك 6 شهور بـ300 جنيه بدل 840 جنيه
ادفع دلوقتي باورنچ كاش
https://myo.orange.eg/YANGO

لأي استفسار كلم 7770
أو تواصل معانا على الواتساب: https://myo.orange.eg/O-whatsapp`;
  const M4 = `لقد استقبلت تحويل أموال بمبلغ 115.00 جنيه من 00201275555667
رصيد اورنچ كاش الجديد 115.49 جنيه رقم المعاملة 3072476204`;

  it('Message 1 — Vodafone, "من رقم", "تاريخ العملية:"', () => {
    expect(parse(M1)).toMatchObject({ carrier: 'VODAFONE', amountMinor: 250000, senderWallet: '01012208430', senderName: 'Alhussien R Kassem', receiverWallet: '01044577552', receiverFromConfig: false, transactionTime: '12:46', transactionDate: '2026-10-14', timeFromReceipt: false, balanceMinor: 250017, reference: '024703283984' });
  });
  it('Message 2 — Vodafone, "من" without "رقم", name on its own line, "بتاريخ"', () => {
    expect(parse(M2)).toMatchObject({ carrier: 'VODAFONE', amountMinor: 8000, senderWallet: '01275555667', senderName: 'ABDELRAHMAN IBRAHIM SHEHAB AYAD', receiverWallet: '01044577552', transactionTime: '02:09', transactionDate: '2026-10-20', balanceMinor: 250888, reference: '024901397476' });
  });
  it('Message 3 — Orange with Vodafone-like prefix, sender NAME, "جنية", campaign text', () => {
    const r = parse(M3);
    expect(r).toMatchObject({ carrier: 'ORANGE', amountMinor: 500500, senderWallet: null, senderName: 'Mohamed N Ewedah', receiverWallet: ORANGE_WALLET, receiverFromConfig: true, balanceMinor: 500520, reference: '25000222476561', timeFromReceipt: true });
    expect(r.occurredAt.toISOString()).toBe(RECEIVED.toISOString());
    expect([r.transactionDate, r.transactionTime]).toEqual(['2026-10-20', '11:15']);
  });
  it('Message 4 — Orange "استقبلت تحويل أموال", international sender', () => {
    const r = parse(M4);
    expect(r).toMatchObject({ carrier: 'ORANGE', amountMinor: 11500, senderWallet: '01275555667', senderName: null, receiverWallet: ORANGE_WALLET, balanceMinor: 11549, reference: '3072476204', timeFromReceipt: true });
    expect(r.occurredAt.toISOString()).toBe(RECEIVED.toISOString());
  });
  it('none of the four fails with SENDER_NOT_FOUND (or anything else)', () => {
    for (const m of [M1, M2, M3, M4]) expect(parseWalletSms(m, { receivedAt: RECEIVED, orangeWallet: ORANGE_WALLET }).ok).toBe(true);
  });
  it('the same four parse in Arabic-Indic digits with identical values', () => {
    const ar = (s: string) => s.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
    for (const m of [M1, M2, M3, M4]) {
      const a = parse(m), b = parse(ar(m));
      expect({ ...b, occurredAt: b.occurredAt.toISOString() }).toEqual({ ...a, occurredAt: a.occurredAt.toISOString() });
    }
  });
  it('Message 3 is NOT treated as Vodafone despite "تم استلام مبلغ"', () => { expect(parse(M3).carrier).toBe('ORANGE'); });
  it('no configured Orange wallet: still parsed, receiver left null (nothing invented)', () => {
    expect(parse(M3, null)).toMatchObject({ receiverWallet: null, receiverFromConfig: false, senderName: 'Mohamed N Ewedah', amountMinor: 500500 });
  });
});

describe('wallet SMS — edge cases', () => {
  const at = new Date('2026-10-20T08:00:00Z'); const W = '01200000001';
  const P = (m: string) => { const r = extractWalletReceipt(m, { receivedAt: at, configuredWallet: W }); if (!r.ok) throw new Error(r.reason); return r; };
  it('1. Arabic comma after a sender name', () => expect(P('تم استلام مبلغ 50.00 جنيه من Abdelrahman I Ayad، رصيدك الحالي 60.00 جنيه، رقم المعاملة 2500000001')).toMatchObject({ senderName: 'Abdelrahman I Ayad', senderWallet: null, balanceMinor: 6000 }));
  it('2. English comma after a sender name', () => expect(P('تم استلام مبلغ 50.00 جنيه من Mohamed N Ewedah, رصيدك الحالي 60.00 جنيه, رقم المعاملة 2500000002')).toMatchObject({ senderName: 'Mohamed N Ewedah', senderWallet: null }));
  it('2b. English/Arabic semicolon after a name', () => {
    expect(P('تم استلام مبلغ 7.00 جنيه من Ali Hassan; رصيدك الحالي 9.00 جنيه; رقم المعاملة 2500000003').senderName).toBe('Ali Hassan');
    expect(P('تم استلام مبلغ 7.00 جنيه من Ali Hassan؛ رصيدك الحالي 9.00 جنيه؛ رقم المعاملة 2500000004').senderName).toBe('Ali Hassan');
  });
  it('3. Vodafone "من رقم 01012208430"', () => expect(P('تم استلام مبلغ 10 جنيه من رقم 01012208430 المسجل بإسم X على رقم محفظتك 01044577552. تاريخ العملية: 12:46 26-10-14 رقم العملية: 024703283985').senderWallet).toBe('01012208430'));
  it('4. Vodafone "من 01275555667" (no "رقم")', () => expect(P('تم استلام مبلغ 10.00 جنيه من 01275555667؛ المسجل بإسم X على رقم محفظتك 01044577552 بتاريخ 02:09 26-10-20. رقم العملية: 024901397477').senderWallet).toBe('01275555667'));
  it('5. international sender formats normalize to 01…', () => {
    for (const s of ['00201275555667', '+201275555667', '201275555667']) expect(P(`لقد استقبلت تحويل أموال بمبلغ 1.00 جنيه من ${s} رصيد اورنچ كاش الجديد 2.00 جنيه رقم المعاملة 30724762${s.length}`).senderWallet).toBe('01275555667');
    expect(P('لقد استقبلت تحويل أموال بمبلغ 5.00 جنيه من 00201009823007رصيد اورنچ كاش الجديد 15.20 جنيه رقم المعاملة 25000247335451').senderWallet).toBe('01009823007'); // glued to "رصيد"
  });
  it('6. Arabic-Indic digits', () => expect(P('تم استلام مبلغ ٥٠٠٥٫٠٠ جنيه من Mohamed N Ewedah، رصيدك الحالي ٥٠٠٥٫٢٠ جنية، رقم المعاملة ٢٥٠٠٠٢٢٢٤٧٦٥٦١')).toMatchObject({ amountMinor: 500500, balanceMinor: 500520, reference: '25000222476561' }));
  it('7. "رقم العملية"', () => expect(P('تم استلام مبلغ 1 جنيه من Ali، رقم العملية: 024901397479').reference).toBe('024901397479'));
  it('8. "رقم المعاملة"', () => expect(P('تم استلام مبلغ 1 جنيه من Ali، رقم المعاملة 25000222476599').reference).toBe('25000222476599'));
  it('9. "جنيه"', () => expect(P('تم استلام مبلغ 7.00 جنيه من Ali، رصيدك الحالي 9.00 جنيه، رقم المعاملة 2500000005').amountMinor).toBe(700));
  it('10. "جنية" (amount and balance)', () => expect(P('تم استلام مبلغ 7.00 جنية من Ali، رصيدك الحالي 9.00 جنية، رقم المعاملة 2500000006')).toMatchObject({ amountMinor: 700, balanceMinor: 900 }));
  it('11. campaign text after the transaction does not leak into fields', () => {
    const r = P('تم استلام مبلغ 5.00 جنيه من Ali Omar، رصيدك الحالي 6.00 جنيه، رقم المعاملة 2500000007.\n\nعرض! وفّر 540 جنيه على اشتراك 6 شهور بـ300 جنيه\nادفع دلوقتي باورنچ كاش https://myo.orange.eg/YANGO\nلأي استفسار كلم 7770');
    expect(r).toMatchObject({ amountMinor: 500, senderName: 'Ali Omar', balanceMinor: 600, reference: '2500000007', carrier: 'ORANGE' });
  });
  it('12. Orange message with "تم استلام مبلغ" is not labelled Vodafone', () => expect(P('تم استلام مبلغ 5.00 جنيه من Ali، رصيدك الحالي 6.00 جنيه، رقم المعاملة 2500000008 ادفع باورنچ كاش').carrier).toBe('ORANGE'));
  it('unknown provider with the same structure is still parsed (label optional)', () => {
    const r = P('تم استلام مبلغ 12.50 جنيه من 01112345678، رصيدك الحالي 20.00 جنيه، رقم العملية 99887766');
    expect(r).toMatchObject({ amountMinor: 1250, senderWallet: '01112345678', balanceMinor: 2000, reference: '99887766', receiverWallet: W });
    expect(r.carrier).toBeUndefined();
  });
  it('never invents a wallet from a name; invalid phone is rejected, not guessed', () => {
    expect(P('تم استلام مبلغ 1 جنيه من محمد أحمد، رقم المعاملة 2500000009')).toMatchObject({ senderWallet: null, senderName: 'محمد أحمد' });
    expect(extractWalletReceipt('تم استلام مبلغ 1 جنيه من 01375555667 رقم المعاملة 2500000010', { receivedAt: at, configuredWallet: W })).toMatchObject({ ok: false, reason: 'SENDER_INVALID' });
  });
  it('a date present but invalid is rejected; missing date uses receivedAt', () => {
    expect(extractWalletReceipt('تم استلام مبلغ 1 جنيه من 01275555667 على رقم محفظتك 01044577552 بتاريخ 25:99 26-13-40', { receivedAt: at, configuredWallet: W })).toMatchObject({ ok: false, reason: 'DATE_INVALID' });
    expect(P('تم استلام مبلغ 1 جنيه من 01275555667 رقم العملية 12345678').timeFromReceipt).toBe(true);
  });
});
