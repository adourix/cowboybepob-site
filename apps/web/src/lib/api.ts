/* Shared HTTP + formatting helpers used by the admin shell and the customer portal. */
const API = import.meta.env.VITE_API_URL || '/';

export function csrfToken() {
  const raw = document.cookie.split('; ').find(x => x.startsWith('cb_csrf='))?.split('=')[1];
  if (!raw) return '';
  try { return decodeURIComponent(raw); } catch { return raw; }
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const h = new Headers(init.headers);
  if (init.body != null) h.set('content-type', 'application/json');
  const csrf = csrfToken();
  if (csrf && init.method && init.method !== 'GET') h.set('x-csrf-token', csrf);
  const r = await fetch(API.replace(/\/$/, '') + path, { ...init, headers: h, credentials: 'include' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((data as any).error || `HTTP ${r.status}`), { status: r.status });
  return data as T;
}

export const money = (v: any, c = 'EGP') => `${(Number(v || 0) / 100).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${c === 'EGP' ? 'جنيه' : c}`;
export const moneyNum = (v: any) => (Number(v || 0) / 100).toLocaleString('ar-EG', { maximumFractionDigits: 2 });
export const date = (v: any) => v ? new Date(v).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
export const dateOnly = (v: any) => v ? new Date(v).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
export const gb = (bytes: any) => bytes == null ? null : Math.round((Number(bytes) / 1073741824) * 10) / 10;
export const num = (v: any) => v == null ? '—' : Number(v).toLocaleString('ar-EG');

export const labels: Record<string, string> = { ACTIVE: 'نشط', PROVISIONING: 'قيد التجهيز', SUSPENDED: 'موقوف', TERMINATED: 'منتهٍ', READY: 'جاهز', ASSIGNED: 'مُسند', IN_STOCK: 'في المخزن', READY_TO_SHIP: 'جاهز للشحن', SHIPPED: 'تم الشحن', ONLINE: 'متصل', OFFLINE: 'غير متصل', UNKNOWN: 'غير معروف', PAID: 'مدفوع', FULFILLING: 'قيد التنفيذ', COMPLETED: 'مكتمل', PENDING_PAYMENT: 'بانتظار الدفع', NEEDS_ATTENTION: 'يحتاج تدخل', SUCCEEDED: 'ناجح', INITIATED: 'مبدئي', QUEUED: 'في الانتظار', RUNNING: 'قيد التشغيل', FAILED: 'فشل', CANCELLED: 'ملغى' };
export const label = (v: any) => labels[String(v)] || v || '—';
/** Display name: keeps Arabic compound names whole (عبد الرحمن, أبو بكر). */
export function shortName(full?: string | null) {
  const w = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  return ['عبد', 'أبو', 'ابو', 'أم', 'ام'].includes(w[0]) && w[1] ? `${w[0]} ${w[1]}` : w[0];
}
export type User = { type: 'STAFF' | 'CUSTOMER'; id: string; role?: string; email: string; fullName: string };
