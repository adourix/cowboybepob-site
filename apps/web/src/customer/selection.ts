/**
 * Customer dashboard selection rules
 * (COWBOYBEPOP_DASHBOARD_CONFIG_SELECTION_V2 — §2, §4, §12, §34, §52).
 *
 *   PRIMARY SERVICE  = router-bound service if any exists
 *                      (several → status priority, then created_at ASC, then id ASC);
 *                      otherwise the first service by created_at ASC, then id ASC.
 *   PRIMARY CONFIG   = the CURRENT config of the primary service (never SUPERSEDED/REVOKED).
 *   LEFT CONFIG CARD = the oldest standalone service, otherwise the primary service.
 *
 * Pure functions only: no fetching, no storage. Callers recompute after every refetch.
 */
export type ServiceStatus = 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'FAILED' | 'TERMINATED';
export type ConfigStatus = 'PENDING' | 'CURRENT' | 'SUPERSEDED' | 'REVOKED';

export type CustomerConfig = {
  publicCode: string; version: number; status: ConfigStatus;
  protocol: string; transport?: string | null; security?: string | null;
};
export type CustomerRouterSummary = { id: string; code?: string | null; model?: string | null; status?: string | null; connectivity?: string | null };
export type CustomerSubscription = {
  status: string; startsAt?: string | null; currentPeriodEnd?: string | null;
  usedBytes?: number; quotaBytes?: number | null; usageSyncedAt?: string | null;
};
export type CustomerService = {
  id: string; code: string; label?: string | null; categoryName?: string | null;
  planId?: string | null; planName?: string | null; durationDays?: number | null;
  status: ServiceStatus | string; createdAt: string;
  router?: CustomerRouterSummary | null;
  subscription?: CustomerSubscription | null;
  config?: CustomerConfig | null;
  configs?: CustomerConfig[];                 // optional: if a DTO ever returns versions
  linkAvailable: boolean;                     // backend link_visibility policy, computed server-side
  location?: { city?: string | null; country?: string | null } | null;
  landline?: { number: string; label?: string | null } | null;
};

/** Maps the customer-safe `/api/v1/customer/services` row to the portal type. */
export function normalizeService(row: any): CustomerService {
  return {
    id: String(row.id), code: row.public_code, label: row.label, categoryName: row.category_name,
    planId: row.plan_id ?? null, planName: row.plan_name ?? null, durationDays: row.duration_days ?? null,
    status: row.status, createdAt: row.created_at,
    router: row.router_id || row.router_code ? { id: String(row.router_id ?? row.router_code), code: row.router_code, model: row.router_model, status: row.router_status, connectivity: row.router_connectivity } : null,
    subscription: row.subscription_status ? { status: row.subscription_status, startsAt: row.starts_at, currentPeriodEnd: row.current_period_end, usedBytes: Number(row.used_bytes || 0), quotaBytes: row.quota_bytes == null ? null : Number(row.quota_bytes), usageSyncedAt: row.usage_synced_at } : null,
    config: row.config_code ? { publicCode: row.config_code, version: Number(row.config_version || 1), status: (row.config_status || 'CURRENT') as ConfigStatus, protocol: row.config_protocol || row.category_protocol || '', transport: row.config_transport, security: row.config_security } : null,
    linkAvailable: Boolean(row.link_available),
    location: row.city || row.country ? { city: row.city, country: row.country } : null,
    landline: row.landline_number ? { number: row.landline_number, label: row.landline_label } : null,
  };
}

export const SERVICE_STATUS_PRIORITY: Record<string, number> = { ACTIVE: 0, PROVISIONING: 1, SUSPENDED: 2, FAILED: 3, TERMINATED: 4 };

export function compareCreatedAtThenId(a: CustomerService, b: CustomerService) {
  const ta = new Date(a.createdAt).getTime(), tb = new Date(b.createdAt).getTime();
  if (ta !== tb) return ta - tb;
  return a.id.localeCompare(b.id);
}

export function compareForPrimary(a: CustomerService, b: CustomerService) {
  const sa = SERVICE_STATUS_PRIORITY[a.status] ?? 999, sb = SERVICE_STATUS_PRIORITY[b.status] ?? 999;
  if (sa !== sb) return sa - sb;
  const ra = a.router ? 0 : 1, rb = b.router ? 0 : 1;
  if (ra !== rb) return ra - rb;
  return compareCreatedAtThenId(a, b);
}

/** Ended services are only chosen when nothing else exists (§4: respect domain rules for ended services). */
const preferLive = (list: CustomerService[]) => { const live = list.filter(s => s.status !== 'TERMINATED'); return live.length ? live : list; };

export function selectPrimaryService(services: CustomerService[]): CustomerService | null {
  const routerBound = services.filter(s => s.router != null);
  if (routerBound.length) return [...routerBound].sort(compareForPrimary)[0];
  return [...preferLive(services)].sort(compareCreatedAtThenId)[0] ?? null;
}

export function selectLeftConfigService(services: CustomerService[]): CustomerService | null {
  const standalone = services.filter(s => s.router == null && s.status !== 'TERMINATED').sort(compareCreatedAtThenId);
  return standalone[0] ?? selectPrimaryService(services);
}

/** CURRENT config only — SUPERSEDED/REVOKED versions are never returned. */
export function currentConfig(service: CustomerService | null | undefined): CustomerConfig | null {
  if (!service) return null;
  if (service.configs?.length) return service.configs.find(c => c.status === 'CURRENT') ?? null;
  return service.config?.status === 'CURRENT' ? service.config : null;
}

/** The link may be requested only when the backend policy allows it and a CURRENT config exists. */
export function canRevealLink(service: CustomerService | null | undefined) {
  return Boolean(service && service.linkAvailable && currentConfig(service) && service.status !== 'PROVISIONING');
}

export function usagePercent(used?: number | null, quota?: number | null) {
  if (!quota || quota <= 0) return null;
  return Math.min(100, Math.max(0, (Number(used || 0) / quota) * 100));
}

export function daysRemaining(end?: string | null, now = Date.now()) {
  if (!end) return null;
  return Math.max(0, Math.ceil((new Date(end).getTime() - now) / 86400000));
}

/** Customer-facing status, computed from service + subscription (architecture §5.2). */
export function customerStatus(s: CustomerService): { key: 'preparing' | 'active' | 'expired' | 'suspended' | 'ended' | 'soon'; text: string } {
  if (s.status === 'PROVISIONING' || s.status === 'FAILED') return { key: 'preparing', text: 'جارٍ التجهيز' };
  if (s.status === 'SUSPENDED') return { key: 'suspended', text: 'موقوفة' };
  if (s.status === 'TERMINATED') return { key: 'ended', text: 'منتهية' };
  if (s.subscription?.status === 'EXPIRED') return { key: 'expired', text: 'انتهت — جدّد للاستمرار' };
  const d = daysRemaining(s.subscription?.currentPeriodEnd);
  if (d != null && d <= 7) return { key: 'soon', text: 'ينتهي قريبًا' };
  return { key: 'active', text: 'نشطة' };
}
