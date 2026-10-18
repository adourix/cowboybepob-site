import { describe, expect, it } from 'vitest';
import { canRevealLink, currentConfig, CustomerService, daysRemaining, normalizeService, selectLeftConfigService, selectPrimaryService, usagePercent } from './selection';

let n = 0;
const svc = (o: Partial<Omit<CustomerService, 'router'>> & { created: string; router?: boolean | CustomerService['router'] }): CustomerService => {
  const id = o.id ?? `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`;
  const router = o.router === true ? { id: `r-${id}`, code: `RTR-${id.slice(-3)}` } : o.router || null;
  return { id, code: `SV-${id.slice(-3)}`, status: o.status ?? 'ACTIVE', createdAt: o.created, router, linkAvailable: o.linkAvailable ?? true,
    config: o.config === undefined ? { publicCode: `CFG-${id.slice(-3)}`, version: 1, status: 'CURRENT', protocol: 'vless' } : o.config, configs: o.configs };
};

describe('primary + left selection (spec §50)', () => {
  it('Test 1 — one standalone: primary = left = standalone', () => {
    const a = svc({ created: '2026-10-01' });
    expect(selectPrimaryService([a])?.id).toBe(a.id);
    expect(selectLeftConfigService([a])?.id).toBe(a.id);
  });
  it('Test 2 — one router-bound: primary = left = router-bound', () => {
    const a = svc({ created: '2026-10-01', router: true });
    expect(selectPrimaryService([a])?.id).toBe(a.id);
    expect(selectLeftConfigService([a])?.id).toBe(a.id);
  });
  it('Test 3 — older standalone + newer router-bound', () => {
    const a = svc({ created: '2026-10-01' }), b = svc({ created: '2026-10-05', router: true });
    expect(selectPrimaryService([a, b])?.id).toBe(b.id);
    expect(selectLeftConfigService([a, b])?.id).toBe(a.id);
  });
  it('Test 4 — router-bound + two standalones: left = oldest standalone', () => {
    const a = svc({ created: '2026-10-01', router: true }), b = svc({ created: '2026-10-05' }), c = svc({ created: '2026-10-10' });
    for (const order of [[a, b, c], [c, b, a], [b, a, c]]) {
      expect(selectPrimaryService(order)?.id).toBe(a.id);
      expect(selectLeftConfigService(order)?.id).toBe(b.id);
    }
  });
  it('Test 5 — two router-bound: status priority, then oldest; left falls back to primary', () => {
    const older = svc({ created: '2026-10-01', router: true, status: 'SUSPENDED' });
    const newerActive = svc({ created: '2026-10-05', router: true, status: 'ACTIVE' });
    expect(selectPrimaryService([older, newerActive])?.id).toBe(newerActive.id);
    expect(selectLeftConfigService([older, newerActive])?.id).toBe(newerActive.id);
    const x = svc({ created: '2026-10-01', router: true }), y = svc({ created: '2026-10-05', router: true });
    expect(selectPrimaryService([y, x])?.id).toBe(x.id);
  });
  it('Test 6 — two standalones: primary = left = oldest (not API order)', () => {
    const a = svc({ created: '2026-10-10' }), b = svc({ created: '2026-10-05' }), c = svc({ created: '2026-10-15' });
    expect(selectPrimaryService([a, b, c])?.id).toBe(b.id);
    expect(selectLeftConfigService([a, b, c])?.id).toBe(b.id);
  });
  it('Test 7 — no services: both null (empty state)', () => {
    expect(selectPrimaryService([])).toBeNull();
    expect(selectLeftConfigService([])).toBeNull();
  });
  it('Test 8 — CURRENT config only, never SUPERSEDED', () => {
    const a = svc({ created: '2026-10-01', config: null, configs: [
      { publicCode: 'CFG-1', version: 1, status: 'SUPERSEDED', protocol: 'vless' },
      { publicCode: 'CFG-2', version: 2, status: 'CURRENT', protocol: 'vless' }] });
    expect(currentConfig(a)?.publicCode).toBe('CFG-2');
    const onlyOld = svc({ created: '2026-10-01', config: { publicCode: 'CFG-1', version: 1, status: 'SUPERSEDED', protocol: 'vless' } });
    expect(currentConfig(onlyOld)).toBeNull();
    const pending = svc({ created: '2026-10-01', status: 'PROVISIONING', config: { publicCode: 'CFG-9', version: 1, status: 'PENDING', protocol: 'vless' } });
    expect(currentConfig(pending)).toBeNull();
    expect(canRevealLink(pending)).toBe(false);
  });
  it('Test 9 — router assignment changes the selection after refetch', () => {
    const a = svc({ id: 'a', created: '2026-10-01' }), b = svc({ id: 'b', created: '2026-10-05' });
    expect(selectPrimaryService([a, b])?.id).toBe('a');
    const refetched = [a, { ...b, router: { id: 'r1', code: 'RTR-001' } }];
    expect(selectPrimaryService(refetched)?.id).toBe('b');
    expect(selectLeftConfigService(refetched)?.id).toBe('a');
  });
  it('Test 10 — visibility disabled: no link, no QR, no copy', () => {
    const hidden = svc({ created: '2026-10-01', router: true, linkAvailable: false });
    expect(canRevealLink(hidden)).toBe(false);
    expect(canRevealLink(svc({ created: '2026-10-01' }))).toBe(true);
  });
});

describe('edge cases', () => {
  it('tie on created_at is broken by id ASC', () => {
    const a = svc({ id: 'bbb', created: '2026-10-01' }), b = svc({ id: 'aaa', created: '2026-10-01' });
    expect(selectPrimaryService([a, b])?.id).toBe('aaa');
  });
  it('ended standalones are skipped when a live one exists', () => {
    const dead = svc({ created: '2026-09-01', status: 'TERMINATED' }), live = svc({ created: '2026-10-01' });
    expect(selectPrimaryService([dead, live])?.id).toBe(live.id);
    expect(selectLeftConfigService([dead, live])?.id).toBe(live.id);
  });
  it('router replacement keeps the same service identity', () => {
    const a = svc({ id: 'svc', created: '2026-10-01', router: { id: 'r1', code: 'RTR-001' } });
    const replaced = { ...a, router: { id: 'r2', code: 'RTR-002' } };
    expect(selectPrimaryService([replaced])?.id).toBe('svc');
  });
  it('usage percent is clamped, unlimited quota → null', () => {
    expect(usagePercent(72, 200)).toBe(36);
    expect(usagePercent(500, 200)).toBe(100);
    expect(usagePercent(-5, 200)).toBe(0);
    expect(usagePercent(5, null)).toBeNull();
  });
  it('days remaining never negative', () => {
    const now = Date.parse('2026-10-20T00:00:00Z');
    expect(daysRemaining('2026-11-07T00:00:00Z', now)).toBe(18);
    expect(daysRemaining('2026-10-01T00:00:00Z', now)).toBe(0);
  });
  it('normalizeService maps the API row and keeps no infrastructure fields', () => {
    const s = normalizeService({ id: '1', public_code: 'SV-1', status: 'ACTIVE', created_at: '2026-10-01', router_id: 'r', router_code: 'RTR-1', config_code: 'CFG-1', config_status: 'CURRENT', config_version: 2, config_protocol: 'vless', config_security: 'reality', link_available: false, subscription_status: 'ACTIVE', used_bytes: '10', quota_bytes: '100' });
    expect(s.router?.code).toBe('RTR-1');
    expect(s.config?.version).toBe(2);
    expect(s.subscription?.usedBytes).toBe(10);
    expect(Object.keys(s)).not.toContain('external_username');
  });
});
