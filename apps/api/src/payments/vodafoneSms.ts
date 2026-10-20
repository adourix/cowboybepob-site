import { normalizeDigits, parseMajorToMinor } from './money.js';

/**
 * Vodafone Cash / Orange Cash "money received" SMS parser.
 *
 * Supported Vodafone variants include:
 *   - "تم استلام مبلغ 2500 جنيه من رقم 01012208430 المسجل بإسم ... على رقم محفظتك ..."
 *   - "تم استلام مبلغ 80.00 جنيه من 01275555667؛ المسجل بإسم ... على رقم محفظتك ... بتاريخ ..."
 *
 * Supported Orange variants include:
 *   - sender name: "... بمبلغ 5005.00 جنيه من Mohamed N Ewedah، رصيدك الحالي ... رقم المعاملة ..."
 *   - sender wallet: "... بمبلغ 115.00 جنيه من 00201275555667 رصيد اورنچ كاش الجديد ..."
 *
 * Orange SMS does not contain a receiving wallet or transaction date/time, so the
 * configured Orange receiving wallet and the phone's receivedAt timestamp are used.
 */
export type Carrier = 'VODAFONE' | 'ORANGE';
export type ParsedSms = {
  ok: true;
  carrier?: Carrier;
  receiverFromConfig?: boolean;
  timeFromReceipt?: boolean;
  amountMinor: number;
  senderWallet: string | null;
  senderName: string | null;
  receiverWallet: string;
  transactionTime: string;
  transactionDate: string;
  occurredAt: Date;
  balanceMinor: number | null;
  reference: string | null;
};
export type ParseFailure = { ok: false; reason: string; looksLikeVodafoneCash: boolean };

/** Egyptian mobile → canonical local form 01XXXXXXXXX, or null. */
export function normalizeWallet(raw: any): string | null {
  let d = normalizeDigits(String(raw ?? '')).replace(/[^0-9]/g, '');
  if (d.startsWith('0020')) d = d.slice(4); else if (d.startsWith('20') && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith('1')) d = '0' + d;
  return /^01[0125]\d{8}$/.test(d) ? d : null;
}

export function looksLikeVodafoneCash(raw: string) {
  const t = normalizeDigits(raw);
  return /تم\s*استلام\s*مبلغ/.test(t) || /محفظتك/.test(t) || /vf\.eg\/vfcash/i.test(t) || /فودافون\s*كاش/.test(t);
}
export function looksLikeOrangeCash(raw: string) {
  const t = normalizeDigits(raw);
  return /استقبلت\s*تحويل\s*أموال/.test(t) || /(?:ا|أ)ورن(?:ج|چ)\s*كاش/.test(t);
}
/** Any wallet receipt we know how to read (used to refuse unrelated personal SMS before storing anything). */
export const looksLikeWalletSms = (raw: string) => looksLikeVodafoneCash(raw) || looksLikeOrangeCash(raw);

function cairoParts(at: Date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(at).map(x => [x.type, x.value]));
}

/**
 * Orange Cash "money received" SMS.
 *
 * Orange has two real formats in use here: one gives the sender wallet, while
 * another gives only the sender's display name. Never invent a wallet for the
 * name-only format; senderWallet remains null and the existing matcher will
 * correctly leave that payment for review instead of falsely auto-matching it.
 */
export function parseOrangeCashSms(raw: string, ctx: { receivedAt: Date; ourWallet: string | null }): ParsedSms | ParseFailure {
  const fail = (reason: string): ParseFailure => ({ ok: false, reason, looksLikeVodafoneCash: looksLikeVodafoneCash(raw || '') });
  if (!raw || raw.length > 2000) return fail('EMPTY_OR_TOO_LONG');
  const t = normalizeDigits(raw).replace(/\s+/g, ' ');
  if (!/استقبلت\s*تحويل\s*أموال/.test(t)) return fail('NOT_A_RECEIPT');

  const amount = t.match(/بمبلغ\s*([\d,]+(?:\.\d{1,2})?)\s*جن(?:يه|ية)/);
  if (!amount) return fail('AMOUNT_NOT_FOUND');

  const afterAmount = t.match(/جن(?:يه|ية)\s*من\s*(.+?)(?=\s*رصيد(?:ك|\s*(?:ا|أ)ورن(?:ج|چ)\s*كاش)\b|\s*$)/);
  const senderRaw = afterAmount?.[1]?.trim().replace(/[؛،,]+$/, '').trim() || null;
  if (!senderRaw) return fail('SENDER_NOT_FOUND');

  let senderWallet: string | null = null;
  let senderName: string | null = null;
  const walletCandidate = senderRaw.match(/^\+?[0-9][0-9\s-]{9,15}$/);
  if (walletCandidate) {
    senderWallet = normalizeWallet(walletCandidate[0]);
    if (!senderWallet) return fail('SENDER_INVALID');
  } else {
    senderName = senderRaw.replace(/[؛،,]+$/, '').trim().slice(0, 120) || null;
    if (!senderName) return fail('SENDER_NOT_FOUND');
  }

  const amountMinor = parseMajorToMinor(amount[1]);
  if (amountMinor == null || amountMinor <= 0) return fail('AMOUNT_INVALID');
  if (!ctx.ourWallet) return fail('ORANGE_WALLET_NOT_CONFIGURED');
  if (isNaN(ctx.receivedAt.getTime())) return fail('DATE_INVALID');

  const balance = t.match(/رصيد(?:ك\s*الحالي|\s*(?:ا|أ)ورن(?:ج|چ)\s*كاش\s*الجديد)\s*:?\s*([\d,]+(?:\.\d{1,2})?)\s*جن(?:يه|ية)?/);
  const ref = t.match(/رقم\s*المعاملة\s*:?\s*([A-Za-z0-9]{6,32})/);
  const parts = cairoParts(ctx.receivedAt);

  return {
    ok: true,
    carrier: 'ORANGE',
    receiverFromConfig: true,
    timeFromReceipt: true,
    amountMinor,
    senderWallet,
    senderName,
    receiverWallet: ctx.ourWallet,
    transactionTime: `${parts.hour}:${parts.minute}`,
    transactionDate: `${parts.year}-${parts.month}-${parts.day}`,
    occurredAt: ctx.receivedAt,
    balanceMinor: balance ? parseMajorToMinor(balance[1]) : null,
    reference: ref ? ref[1] : null,
  };
}

/** Picks the right parser for the SMS format. */
export function parseWalletSms(raw: string, ctx: { receivedAt: Date; orangeWallet: string | null }): ParsedSms | ParseFailure {
  const t = normalizeDigits(raw || '');
  if (looksLikeOrangeCash(raw) && !/تم\s*استلام\s*مبلغ/.test(t)) {
    return parseOrangeCashSms(raw, { receivedAt: ctx.receivedAt, ourWallet: ctx.orangeWallet });
  }
  const r = parseVodafoneCashSms(raw);
  return r.ok ? { ...r, carrier: 'VODAFONE' } : r;
}

/** Africa/Cairo wall-clock → UTC instant (handles Egypt DST via ICU). */
export function cairoToUtc(y: number, mo: number, d: number, h: number, mi: number): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const offsetAt = (ms: number) => { const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(x => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ms; };
  const off1 = offsetAt(guess); const off2 = offsetAt(guess - off1);
  return new Date(guess - off2);
}

export function parseVodafoneCashSms(raw: string): ParsedSms | ParseFailure {
  const looks = looksLikeVodafoneCash(raw || '');
  const fail = (reason: string): ParseFailure => ({ ok: false, reason, looksLikeVodafoneCash: looks });
  if (!raw || raw.length > 2000) return fail('EMPTY_OR_TOO_LONG');
  const t = normalizeDigits(raw).replace(/\s+/g, ' ');
  if (!/تم\s*استلام\s*مبلغ/.test(t)) return fail('NOT_A_RECEIPT');

  const amount = t.match(/استلام\s*مبلغ\s*([\d,]+(?:\.\d{1,2})?)\s*جنيه/);
  const sender = t.match(/جنيه\s*من\s*(?:رقم\s*)?(\+?\d[\d\s-]{9,15})/);
  const receiver = t.match(/رقم\s*محفظتك\s*(\+?\d[\d\s-]{9,15})/);
  const when = t.match(/(?:بتاريخ|تاريخ\s*العملية)\s*:?\s*(\d{1,2}):(\d{2})\s*(\d{2,4})-(\d{1,2})-(\d{1,2})/);
  if (!amount) return fail('AMOUNT_NOT_FOUND');
  if (!sender) return fail('SENDER_NOT_FOUND');
  if (!receiver) return fail('RECEIVER_NOT_FOUND');
  if (!when) return fail('DATE_NOT_FOUND');

  const amountMinor = parseMajorToMinor(amount[1]);
  const senderWallet = normalizeWallet(sender[1]);
  const receiverWallet = normalizeWallet(receiver[1]);
  if (amountMinor == null || amountMinor <= 0) return fail('AMOUNT_INVALID');
  if (!senderWallet) return fail('SENDER_INVALID');
  if (!receiverWallet) return fail('RECEIVER_INVALID');

  const [hh, mm, yy, mo, dd] = [Number(when[1]), Number(when[2]), Number(when[3]), Number(when[4]), Number(when[5])];
  const year = yy < 100 ? 2000 + yy : yy;
  if (hh > 23 || mm > 59 || mo < 1 || mo > 12 || dd < 1 || dd > 31) return fail('DATE_INVALID');
  const occurredAt = cairoToUtc(year, mo, dd, hh, mm);
  const name = t.match(/المسجل\s*ب(?:إ|ا)سم\s*(.+?)\s*على\s*رقم\s*محفظتك/);
  const balance = t.match(/رصيدك\s*الحالي\s*:?\s*([\d,]+(?:\.\d{1,2})?)/);
  const ref = t.match(/رقم\s*العملية\s*:?\s*([A-Za-z0-9]{6,32})/);

  return {
    ok: true,
    amountMinor,
    senderWallet,
    senderName: name ? name[1].trim().slice(0, 120) : null,
    receiverWallet,
    transactionTime: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    transactionDate: `${year}-${String(mo).padStart(2, '0')}-${String(dd).padStart(2, '0')}`,
    occurredAt,
    balanceMinor: balance ? parseMajorToMinor(balance[1]) : null,
    reference: ref ? ref[1] : null,
  };
}
