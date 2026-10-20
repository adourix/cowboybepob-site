/** Server-side method availability. The UI mirrors this, but this is the rule that is enforced. */
export type PaymentMethod = 'VODAFONE_CASH' | 'CARD' | 'APPLE_PAY';
export const PROVIDER_FOR: Record<PaymentMethod, 'MANUAL_VODAFONE_CASH' | 'KASHIER'> = { VODAFONE_CASH: 'MANUAL_VODAFONE_CASH', CARD: 'KASHIER', APPLE_PAY: 'KASHIER' };
export function isPaymentMethod(v: any): v is PaymentMethod { return v === 'VODAFONE_CASH' || v === 'CARD' || v === 'APPLE_PAY'; }

export function methodAvailability(amountMinor: number, o: { gatewayMinMinor: number; kashierReady: boolean; vodafoneReady: boolean }) {
  const gatewayOk = amountMinor >= o.gatewayMinMinor;
  const kashierReason = !gatewayOk ? 'BELOW_GATEWAY_MINIMUM' : !o.kashierReady ? 'GATEWAY_NOT_CONFIGURED' : null;
  return [
    { method: 'VODAFONE_CASH' as const, available: o.vodafoneReady, reason: o.vodafoneReady ? null : 'WALLET_NOT_CONFIGURED' },
    { method: 'CARD' as const, available: !kashierReason, reason: kashierReason },
    { method: 'APPLE_PAY' as const, available: !kashierReason, reason: kashierReason },
  ];
}
