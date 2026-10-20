/** Integer minor units (piasters) only. No floating-point arithmetic anywhere in payments. */
const ARABIC_DIGITS: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };

/** Arabic-Indic / Persian digits → ASCII; Arabic decimal & thousands separators → '.' / ','. */
export function normalizeDigits(input: string) {
  return String(input ?? '').replace(/[٠-٩۰-۹]/g, d => ARABIC_DIGITS[d]).replace(/٫/g, '.').replace(/٬/g, ',');
}

/** "165.00" | "165" | "1,250.5" | "١٦٥٫٠٠" → 16500 (piasters). Returns null on anything ambiguous. */
export function parseMajorToMinor(input: string | number): number | null {
  const s = normalizeDigits(String(input)).trim().replace(/,/g, '');
  const m = s.match(/^(\d{1,12})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const cents = (m[2] || '').padEnd(2, '0');
  return Number(m[1]) * 100 + Number(cents);
}

/** 16500 → "165.00" (string arithmetic, safe for Kashier hashing and display). */
export function formatMinor(minor: number | bigint | string) {
  const n = BigInt(String(minor));
  const neg = n < 0n, abs = neg ? -n : n;
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
