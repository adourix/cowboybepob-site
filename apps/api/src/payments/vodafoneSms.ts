import { normalizeDigits, parseMajorToMinor } from './money.js';

/**
 * Vodafone Cash "money received" SMS parser.
 * Example (receiving wallet's SMS):
 *   تم استلام مبلغ 165.00 جنيه من 01275555667؛ المسجل بإسم ABDELRAHMAN ...
 *   على رقم محفظتك 01044577552 بتاريخ 18:47 26-10-16.
 *   رصيدك الحالي: 2509.88 جنيه  رقم العملية: 024786200222
 * Date is YY-MM-DD in Egypt local time (Africa/Cairo).
 */
export type ParsedSms = {
  ok: true; amountMinor: number; senderWallet: string; senderName: string | null; receiverWallet: string;
  transactionTime: string; transactionDate: string; occurredAt: Date; balanceMinor: number | null; reference: string | null;
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
  const sender = t.match(/جنيه\s*من\s*(\+?\d[\d\s-]{9,15})/);
  const receiver = t.match(/رقم\s*محفظتك\s*(\+?\d[\d\s-]{9,15})/);
  const when = t.match(/بتاريخ\s*(\d{1,2}):(\d{2})\s*(\d{2,4})-(\d{1,2})-(\d{1,2})/);
  if (!amount) return fail('AMOUNT_NOT_FOUND');
  if (!sender) return fail('SENDER_NOT_FOUND');
  if (!receiver) return fail('RECEIVER_NOT_FOUND');
  if (!when) return fail('DATE_NOT_FOUND');
  const amountMinor = parseMajorToMinor(amount[1]);
  const senderWallet = normalizeWallet(sender[1]); const receiverWallet = normalizeWallet(receiver[1]);
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
    ok: true, amountMinor, senderWallet, senderName: name ? name[1].trim().slice(0, 120) : null, receiverWallet,
    transactionTime: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, transactionDate: `${year}-${String(mo).padStart(2, '0')}-${String(dd).padStart(2, '0')}`,
    occurredAt, balanceMinor: balance ? parseMajorToMinor(balance[1]) : null, reference: ref ? ref[1] : null,
  };
}
