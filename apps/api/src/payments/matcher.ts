import type { ParsedSms } from './vodafoneSms.js';

/** A Vodafone Cash payment that is waiting for its SMS. */
export type PendingPayment = { id: string; amountMinor: number; customerWallet: string | null; receivingWallet: string | null; createdAt: Date; expiresAt: Date | null };
export type MatchCheck = { amount: boolean; sender: boolean; receiver: boolean; time: boolean };
export type MatchResult =
  | { status: 'MATCHED'; paymentId: string; checks: MatchCheck; alsoMatching: string[] }
  | { status: 'UNMATCHED'; reason: string; closest?: { paymentId: string; checks: MatchCheck } };

/**
 * Primary fields: amount, sender wallet, receiver wallet, SMS time inside the payment window.
 * Transaction reference is only used for duplicate protection (checked before matching).
 * Several identical open payments → oldest first; the rest wait for their own SMS.
 */
export function matchSms(sms: ParsedSms, candidates: PendingPayment[], opts: { skewMinutes: number }): MatchResult {
  const skew = opts.skewMinutes * 60000;
  const checked = candidates.map(p => {
    const from = p.createdAt.getTime() - skew;
    const to = (p.expiresAt ? p.expiresAt.getTime() : p.createdAt.getTime()) + skew;
    const checks: MatchCheck = {
      amount: p.amountMinor === sms.amountMinor,
      sender: !!p.customerWallet && p.customerWallet === sms.senderWallet,
      receiver: !!p.receivingWallet && p.receivingWallet === sms.receiverWallet,
      time: sms.occurredAt.getTime() >= from && sms.occurredAt.getTime() <= to,
    };
    return { p, checks, score: Number(checks.amount) + Number(checks.sender) + Number(checks.receiver) + Number(checks.time) };
  });
  const full = checked.filter(x => x.score === 4).sort((a, b) => a.p.createdAt.getTime() - b.p.createdAt.getTime() || a.p.id.localeCompare(b.p.id));
  if (full.length) return { status: 'MATCHED', paymentId: full[0].p.id, checks: full[0].checks, alsoMatching: full.slice(1).map(x => x.p.id) };
  const best = checked.sort((a, b) => b.score - a.score)[0];
  if (!best) return { status: 'UNMATCHED', reason: 'NO_OPEN_PAYMENTS' };
  const c = best.checks;
  const reason = !c.receiver ? 'RECEIVER_MISMATCH' : !c.sender ? 'SENDER_MISMATCH' : !c.amount ? 'AMOUNT_MISMATCH' : 'OUTSIDE_PAYMENT_WINDOW';
  return { status: 'UNMATCHED', reason, closest: { paymentId: best.p.id, checks: c } };
}
