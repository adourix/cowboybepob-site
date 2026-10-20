import { normalizeDigits, parseMajorToMinor } from './money.js';

/**
 * Wallet "money received" SMS parser (Vodafone Cash, Orange Cash, and similar formats).
 *
 * Design: DATA EXTRACTION first, provider label last. One pass extracts:
 *   amount → sender (phone if present, otherwise name) → receiver (if present) →
 *   balance → reference → transaction date/time (if present).
 * A valid receipt is never rejected because the provider is ambiguous.
 *
 * Real formats covered by regression tests (payments.test.ts):
 *   Vodafone: "تم استلام مبلغ 2500 جنيه من رقم 01012208430 المسجل بإسم … على رقم محفظتك … تاريخ العملية: 12:46 26-10-14 …"
 *   Vodafone: "تم استلام مبلغ 80.00 جنيه من 01275555667؛ المسجل بإسم … على رقم محفظتك … بتاريخ 02:09 26-10-20. …"
 *   Orange:   "تم استلام مبلغ 5005.00 جنيه من Mohamed N Ewedah، رصيدك الحالي 5005.20 جنية، رقم المعاملة …" + campaign text
 *   Orange:   "لقد استقبلت تحويل أموال بمبلغ 115.00 جنيه من 00201275555667 رصيد اورنچ كاش الجديد … رقم المعاملة …"
 *
 * When the SMS has no receiving wallet (Orange), the configured receiving wallet is used (ORANGE_CASH_RECEIVING_WALLET);
 * when it has no date/time, the phone's receivedAt is used. Missing data is never invented (e.g. no wallet from a name).
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
  receiverWallet: string | null; // null only when the SMS has none and no wallet is configured
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
  return /استقبلت\s*تحويل\s*أموال/.test(t) || /(?:ا|أ)ورن(?:ج|چ)\s*كاش/.test(t) || /myo\.orange\.eg\//i.test(t);
}
/** Any wallet receipt we know how to read (used to refuse unrelated personal SMS before storing anything). */
export const looksLikeWalletSms = (raw: string) => looksLikeVodafoneCash(raw) || looksLikeOrangeCash(raw);

function cairoParts(at: Date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(at).map(x => [x.type, x.value]));
}

const CUR = 'جن(?:يه|ية)';                                   // "جنيه" or the common misspelling "جنية"
const NUM = '([\\d,]+(?:\\.\\d{1,2})?)';
const PHONE = '(\\+?\\d[\\d \\-]{8,16}\\d)';                   // digits, spaces or dashes; stops at the first letter ("…667رصيد")
const ORANGE_MARK = /(?:ا|أ)ورن(?:ج|چ)\s*كاش|orange\.eg|استقبلت\s*تحويل\s*(?:أ|ا)موال/i;
const VODAFONE_MARK = /vf\.eg|فودافون|رقم\s*محفظتك/i;

/**
 * Text prep: Arabic-Indic digits → ASCII, spaces collapsed, but line breaks KEPT
 * (a line break ends a sender name, e.g. "المسجل بإسم NAME\nعلى رقم محفظتك").
 */
function prep(raw: string) {
  return normalizeDigits(raw).replace(/\r/g, '').replace(/[ \t\u00A0\u200F\u200E]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

/** The single extraction pass used by every entry point below. */
export function extractWalletReceipt(raw: string, ctx: { receivedAt?: Date; configuredWallet?: string | null }): ParsedSms | ParseFailure {
  const looks = looksLikeWalletSms(raw || '');
  const fail = (reason: string): ParseFailure => ({ ok: false, reason, looksLikeVodafoneCash: looks });
  if (!raw || raw.length > 2000) return fail('EMPTY_OR_TOO_LONG');
  const t = prep(raw);
  if (!/تم\s*استلام\s*مبلغ|استقبلت\s*تحويل\s*(?:أ|ا)موال/.test(t)) return fail('NOT_A_RECEIPT');

  // 1. amount
  const amount = new RegExp(`(?:استلام\\s*مبلغ|بمبلغ)\\s*${NUM}\\s*${CUR}`).exec(t);
  if (!amount) return fail('AMOUNT_NOT_FOUND');
  const amountMinor = parseMajorToMinor(amount[1]);
  if (amountMinor == null || amountMinor <= 0) return fail('AMOUNT_INVALID');

  // 2. sender: the text right after "<amount> جنيه من [رقم]" — a phone number, or else a name
  const rest = t.slice(amount.index + amount[0].length);
  const from = /^\s*من\s*(?:رقم\s*)?/.exec(rest);
  if (!from) return fail('SENDER_NOT_FOUND');
  const seg = rest.slice(from[0].length);
  let senderWallet: string | null = null, senderName: string | null = null;
  const phone = new RegExp(`^${PHONE}`).exec(seg);
  if (phone) {
    senderWallet = normalizeWallet(phone[1]);
    if (!senderWallet) return fail('SENDER_INVALID');
    const reg = /المسجل\s*ب(?:إ|ا)سم\s*(.+?)\s*(?=على\s*رقم\s*محفظتك|[،,؛;\n]|$)/.exec(t);
    senderName = reg ? reg[1].trim().slice(0, 120) || null : null;
  } else {
    // A name ends at Arabic/English punctuation, a line break, or the next known field.
    const nm = /^(.+?)\s*(?=[،,؛;\n]|\.(?:\s|$)|المسجل|رصيد|على\s*رقم|رقم\s*(?:العملية|المعاملة)|$)/.exec(seg);
    senderName = nm ? nm[1].replace(/[\s.،,؛;]+$/, '').trim().slice(0, 120) || null : null;
    if (!senderName) return fail('SENDER_NOT_FOUND');
  }

  // 3. receiver: in the SMS if present (Vodafone), else the configured wallet (Orange has none)
  let receiverWallet: string | null = null, receiverFromConfig = false;
  const recv = new RegExp(`رقم\\s*محفظتك\\s*:?\\s*${PHONE}`).exec(t);
  if (recv) { receiverWallet = normalizeWallet(recv[1]); if (!receiverWallet) return fail('RECEIVER_INVALID'); }
  else if (ctx.configuredWallet) { receiverWallet = ctx.configuredWallet; receiverFromConfig = true; }

  // 4. transaction time: in the SMS if present, else when the phone received it
  let occurredAt: Date, transactionTime: string, transactionDate: string, timeFromReceipt = false;
  const when = /(?:بتاريخ|تاريخ\s*العملية)\s*:?\s*(\d{1,2}):(\d{2})\s*(\d{2,4})[-/.‐–](\d{1,2})[-/.‐–](\d{1,2})/.exec(t);
  if (when) {
    const [hh, mm, yy, mo, dd] = [Number(when[1]), Number(when[2]), Number(when[3]), Number(when[4]), Number(when[5])];
    const year = yy < 100 ? 2000 + yy : yy;
    if (hh > 23 || mm > 59 || mo < 1 || mo > 12 || dd < 1 || dd > 31) return fail('DATE_INVALID');
    occurredAt = cairoToUtc(year, mo, dd, hh, mm);
    transactionTime = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    transactionDate = `${year}-${String(mo).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  } else {
    if (!ctx.receivedAt || isNaN(ctx.receivedAt.getTime())) return fail('DATE_NOT_FOUND');
    occurredAt = ctx.receivedAt; timeFromReceipt = true;
    const p = cairoParts(ctx.receivedAt);
    transactionTime = `${p.hour}:${p.minute}`; transactionDate = `${p.year}-${p.month}-${p.day}`;
  }

  // 5. balance + reference
  const balance = new RegExp(`رصيد(?:ك)?\\s*(?:الحالي|(?:ا|أ)ورن(?:ج|چ)\\s*كاش\\s*الجديد|الجديد)\\s*:?\\s*${NUM}`).exec(t);
  const ref = /رقم\s*(?:العملية|المعاملة)\s*:?\s*([A-Za-z0-9]{6,32})/.exec(t);

  // 6. provider label (informational only)
  const carrier: Carrier | undefined = recv && VODAFONE_MARK.test(t) ? 'VODAFONE' : ORANGE_MARK.test(t) ? 'ORANGE' : VODAFONE_MARK.test(t) ? 'VODAFONE' : undefined;

  return {
    ok: true, carrier, receiverFromConfig, timeFromReceipt, amountMinor, senderWallet, senderName, receiverWallet,
    transactionTime, transactionDate, occurredAt, balanceMinor: balance ? parseMajorToMinor(balance[1]) : null, reference: ref ? ref[1] : null,
  };
}

/** Entry point used by ingestion. `orangeWallet` is the configured wallet for receipts that don't name one. */
export function parseWalletSms(raw: string, ctx: { receivedAt: Date; orangeWallet: string | null }): ParsedSms | ParseFailure {
  return extractWalletReceipt(raw, { receivedAt: ctx.receivedAt, configuredWallet: ctx.orangeWallet });
}

/** Compatibility wrapper (same extraction). */
export function parseOrangeCashSms(raw: string, ctx: { receivedAt: Date; ourWallet: string | null }): ParsedSms | ParseFailure {
  return extractWalletReceipt(raw, { receivedAt: ctx.receivedAt, configuredWallet: ctx.ourWallet });
}

/** Africa/Cairo wall-clock → UTC instant (handles Egypt DST via ICU). */
export function cairoToUtc(y: number, mo: number, d: number, h: number, mi: number): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const offsetAt = (ms: number) => { const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(x => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ms; };
  const off1 = offsetAt(guess); const off2 = offsetAt(guess - off1);
  return new Date(guess - off2);
}

/** Compatibility wrapper (same extraction). Without receivedAt, a receipt must carry its own date. */
export function parseVodafoneCashSms(raw: string, receivedAt?: Date): ParsedSms | ParseFailure {
  return extractWalletReceipt(raw, { receivedAt, configuredWallet: null });
}
