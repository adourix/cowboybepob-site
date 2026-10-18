import React, { useState } from 'react';
import { api, dateOnly, gb } from '../lib/api';
import { canRevealLink, currentConfig, customerStatus, CustomerService, daysRemaining, usagePercent } from './selection';
import { Bar, copyText, Modal, Pill, QrImage } from './ui';

export const statusTone = (s: CustomerService) => ({ active: 'ok', soon: 'warn', preparing: 'info', expired: 'bad', suspended: 'bad', ended: 'idle' } as const)[customerStatus(s).key];
export const upper = (v?: string | null) => (v ? String(v).toUpperCase() : '—');
export const countryName = (c?: string | null) => ({ DE: 'ألمانيا', NL: 'هولندا', TR: 'تركيا', US: 'أمريكا', SG: 'سنغافورة', FR: 'فرنسا', GB: 'بريطانيا', EG: 'مصر', AE: 'الإمارات', SA: 'السعودية' } as Record<string, string>)[String(c || '').toUpperCase()] || c || '';
export const locationLabel = (s: CustomerService) => s.location ? [s.location.city, countryName(s.location.country)].filter(Boolean).join(' - ') : '—';

/**
 * Link reveal is audited, so it only happens when the customer presses a button.
 * The result is kept in component memory (never localStorage) and only for that service.
 */
export function useServiceLink(onError: (m: string) => void) {
  const [links, setLinks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const reveal = async (s: CustomerService | null): Promise<string | null> => {
    if (!s || !canRevealLink(s)) { onError('الرابط غير متاح لهذه الخدمة'); return null; }
    if (links[s.id]) return links[s.id];
    setBusy(s.id);
    try { const x = await api<{ link: string }>(`/api/v1/customer/services/${s.id}/config`); setLinks(l => ({ ...l, [s.id]: x.link })); return x.link; }
    catch (e: any) { onError(e.message); return null; }
    finally { setBusy(null); }
  };
  return { reveal, busy, cached: (id?: string) => (id ? links[id] : undefined) };
}

export function settingsText(s: CustomerService, link: string) {
  const c = currentConfig(s);
  return [`الخدمة: ${s.code}`, `البروتوكول: ${upper(c?.protocol)}`, `النقل: ${upper(c?.transport)}`, `الأمان: ${upper(c?.security)}`, `الموقع: ${locationLabel(s)}`, '', link].join('\n');
}

export function downloadLink(s: CustomerService, link: string) {
  const blob = new Blob([link + '\n'], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${s.code}.txt`; a.click(); URL.revokeObjectURL(a.href);
}

export function QrModal({ service, link, onClose }: { service: CustomerService; link: string; onClose: () => void }) {
  return <Modal title={`رمز QR — ${service.code}`} onClose={onClose}>
    <div className="qr-wrap"><QrImage text={link} /><p>امسح الرمز من تطبيق البروكسي على هاتفك لإضافة الخدمة.</p></div>
  </Modal>;
}

export function ServiceDetailsModal({ service, onClose }: { service: CustomerService; onClose: () => void }) {
  const c = currentConfig(service), sub = service.subscription, pct = usagePercent(sub?.usedBytes, sub?.quotaBytes);
  const rows: [string, React.ReactNode][] = [
    ['رمز الخدمة', <span dir="ltr">{service.code}</span>], ['اسم الخدمة', service.label || service.categoryName || '—'],
    ['الحالة', <Pill tone={statusTone(service)}>{customerStatus(service).text}</Pill>],
    ['البروتوكول', upper(c?.protocol)], ['النقل', upper(c?.transport)], ['الأمان', upper(c?.security)],
    ['الاشتراك', sub ? `${sub.status === 'ACTIVE' ? 'نشط' : sub.status === 'EXPIRED' ? 'منتهٍ' : sub.status === 'PENDING' ? 'لم يبدأ بعد' : sub.status}${service.planName ? ' — ' + service.planName : ''}` : 'بدون اشتراك'],
    ['البداية', dateOnly(sub?.startsAt)], ['الانتهاء', dateOnly(sub?.currentPeriodEnd)],
    ['الاستهلاك', sub ? `${gb(sub.usedBytes) ?? 0} GB${sub.quotaBytes ? ` / ${gb(sub.quotaBytes)} GB` : ' — بدون حد'}` : '—'],
    ['الراوتر', service.router ? `${service.router.model || ''} ${service.router.code || ''}`.trim() : 'غير مرتبط'],
    ['حالة الكونفيج', c ? 'فعّال' : service.status === 'PROVISIONING' ? 'جارٍ التجهيز' : 'غير متاح'], ['نسخة الكونفيج', c ? `v${c.version}` : '—'],
    ['الموقع', locationLabel(service)],
  ];
  return <Modal title="تفاصيل الخدمة" onClose={onClose}>
    <dl className="kv">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    {pct != null && <Bar pct={pct} />}
  </Modal>;
}

export function remainingText(s: CustomerService) {
  const d = daysRemaining(s.subscription?.currentPeriodEnd);
  return d == null ? '—' : `${d.toLocaleString('ar-EG')} يوم`;
}
export { copyText };
