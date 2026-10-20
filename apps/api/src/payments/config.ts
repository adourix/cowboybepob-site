import { parseMajorToMinor } from './money.js';
import { normalizeWallet } from './vodafoneSms.js';

/** All payment configuration in one place; read once per call so tests can override env. */
export function paymentConfig() {
  const env = process.env;
  const gatewayMin = parseMajorToMinor(env.PAYMENT_GATEWAY_MIN_AMOUNT || '75');
  if (gatewayMin == null) throw new Error('PAYMENT_GATEWAY_MIN_AMOUNT is invalid');
  const list = (v?: string) => String(v || '').split(',').map(w => normalizeWallet(w)).filter(Boolean) as string[];
  const vodafoneWallets = list(env.VODAFONE_CASH_RECEIVING_WALLET), orangeWallets = list(env.ORANGE_CASH_RECEIVING_WALLET);
  return {
    gatewayMinMinor: gatewayMin,
    reviewHours: positiveInt(env.ACCOUNTANT_REVIEW_HOURS, 24),
    paymentWindowMinutes: positiveInt(env.PAYMENT_WINDOW_MINUTES, 30),
    smsClockSkewMinutes: positiveInt(env.PAYMENT_SMS_CLOCK_SKEW_MINUTES, 10),
    provisionalActivation: env.PAYMENT_PROVISIONAL_ACTIVATION !== 'false',
    // Activate as soon as the customer submits wallet + receipt (before any SMS), for the review window.
    activateOnProof: env.PAYMENT_ACTIVATE_ON_PROOF !== 'false',
    // Customers with a rejected/expired-review wallet payment in this many days wait for the accountant instead.
    proofActivationBlockDays: positiveInt(env.PAYMENT_PROOF_ACTIVATION_BLOCK_DAYS, 30),
    vodafoneWallets, orangeWallets,
    receivingWallets: [...vodafoneWallets, ...orangeWallets], // any SMS must be for one of OUR wallets
    uploadDir: env.PAYMENT_UPLOAD_DIR || 'storage/payment-screenshots',
    maxScreenshotBytes: positiveInt(env.PAYMENT_SCREENSHOT_MAX_BYTES, 4 * 1024 * 1024),
    publicAppUrl: (env.PUBLIC_APP_URL || env.CORS_ORIGIN || 'http://localhost:5173').replace(/\/$/, ''),
    publicApiUrl: (env.PUBLIC_API_URL || env.PUBLIC_APP_URL || env.CORS_ORIGIN || 'http://localhost:5002').replace(/\/$/, ''),
    bootstrapDeviceToken: env.ANDROID_PAYMENT_DEVICE_TOKEN || '',
    kashier: {
      merchantId: env.KASHIER_MERCHANT_ID || '',
      apiKey: env.KASHIER_API_KEY || '',            // "Payment API Key": signs order hash + verifies webhooks
      mode: (env.KASHIER_MODE === 'live' ? 'live' : 'test') as 'live' | 'test',
      checkoutUrl: (env.KASHIER_CHECKOUT_URL || 'https://checkout.kashier.io').replace(/\/$/, ''),
      webhookAmountUnit: (env.KASHIER_WEBHOOK_AMOUNT_UNIT === 'minor' ? 'minor' : 'major') as 'major' | 'minor',
      checkoutTtlMinutes: positiveInt(env.KASHIER_CHECKOUT_TTL_MINUTES, 60),
    },
  };
}
export type PaymentConfig = ReturnType<typeof paymentConfig>;
function positiveInt(v: any, d: number) { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : d; }
export const kashierConfigured = (c: PaymentConfig) => Boolean(c.kashier.merchantId && c.kashier.apiKey);
