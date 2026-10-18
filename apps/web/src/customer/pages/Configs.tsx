import React, { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Box, CalendarDays, CheckCircle2, Clock3, Copy, Gauge, MapPin, MoreHorizontal, QrCode, Search } from 'lucide-react';
import { dateOnly, gb, num, shortName } from '../../lib/api';
import { AccountLayout, usePortal } from '../Portal';
import { canRevealLink, compareCreatedAtThenId, currentConfig, customerStatus, CustomerService, daysRemaining, usagePercent } from '../selection';
import { Banner, Bar, Empty, Hud, Pill, useToast } from '../ui';
import { copyText, locationLabel, QrModal, ServiceDetailsModal, statusTone, upper, useServiceLink } from '../serviceActions';

const PROTO_TONE: Record<string, string> = { vless: 'violet', vmess: 'cyan', trojan: 'red', shadowsocks: 'blue' };

export function ConfigsPage() {
  const { user, services } = usePortal(); const toast = useToast(); const link = useServiceLink(toast.bad);
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [proto, setProto] = useState(''); const [cat, setCat] = useState('');
  const [qr, setQr] = useState<{ s: CustomerService; link: string } | null>(null); const [details, setDetails] = useState<CustomerService | null>(null);
  const sorted = useMemo(() => [...services].sort(compareCreatedAtThenId), [services]);
  const protos = Array.from(new Set(sorted.map(s => currentConfig(s)?.protocol).filter(Boolean))) as string[];
  const cats = Array.from(new Set(sorted.map(s => s.categoryName).filter(Boolean))) as string[];
  const rows = sorted.filter(s => (!q || `${s.code} ${s.label || ''} ${s.categoryName || ''}`.toLowerCase().includes(q.toLowerCase())) && (!status || customerStatus(s).key === status) && (!proto || currentConfig(s)?.protocol === proto) && (!cat || s.categoryName === cat));
  const active = services.filter(s => customerStatus(s).key === 'active' || customerStatus(s).key === 'soon').length;
  const soon = services.filter(s => customerStatus(s).key === 'soon').length;
  const copy = async (s: CustomerService) => { const l = await link.reveal(s); if (l && await copyText(l)) toast.ok('تم نسخ الرابط'); };
  const showQr = async (s: CustomerService) => { const l = await link.reveal(s); if (l) setQr({ s, link: l }); };

  return <>
    {toast.node}
    <Banner art="bridge" eyebrow="WELCOME BACK" title={shortName(user.fullName)} sub="إدارة حسابك وخدماتك في مكان واحد." />
    <AccountLayout>
      <Hud className="page-title"><h1>كل الكونفيجات</h1><p>جميع كونفيجات الاتصال النشطة والمتاحة في حسابك.</p></Hud>
      <div className="stat-row">
        <Hud className="stat"><Clock3 size={34} className="ico warn" /><div><span>تنتهي قريبًا</span><b>{num(soon)}</b></div></Hud>
        <Hud className="stat"><CheckCircle2 size={34} className="ico ok" /><div><span>نشطة حاليًا</span><b>{num(active)}</b></div></Hud>
        <Hud className="stat"><Box size={34} className="ico info" /><div><span>إجمالي الكونفيجات</span><b>{num(services.length)}</b></div></Hud>
      </div>
      <Hud className="filters">
        <label className="cx-search"><Search size={20} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="البحث في الكونفيجات…" aria-label="بحث" /></label>
        <select value={cat} onChange={e => setCat(e.target.value)} aria-label="الخدمة"><option value="">جميع الخدمات</option>{cats.map(c => <option key={c}>{c}</option>)}</select>
        <select value={proto} onChange={e => setProto(e.target.value)} aria-label="البروتوكول"><option value="">جميع البروتوكولات</option>{protos.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}</select>
        <select value={status} onChange={e => setStatus(e.target.value)} aria-label="الحالة"><option value="">جميع الحالات</option><option value="active">نشطة</option><option value="soon">تنتهي قريبًا</option><option value="preparing">جارٍ التجهيز</option><option value="expired">منتهية</option><option value="suspended">موقوفة</option></select>
      </Hud>
      <div className="cfg-list">
        {rows.map(s => { const c = currentConfig(s), sub = s.subscription, pct = usagePercent(sub?.usedBytes, sub?.quotaBytes), ok = canRevealLink(s), p = (c?.protocol || '').toLowerCase();
          return <Hud key={s.id} className="cfg-row" tone={customerStatus(s).key === 'soon' ? 'gold' : 'cyan'}>
            <div className="cfg-id">
              <span className={`proto-badge t-${PROTO_TONE[p] || 'cyan'} en`}>{(p || '?').slice(0, 2).toUpperCase()}</span>
              <div><b>{s.label || s.categoryName}</b><small>{s.categoryName}{s.planName ? ` — ${s.planName}` : ''}</small><span className={`chip t-${PROTO_TONE[p] || 'cyan'} en`}>{upper(c?.protocol)}{c?.security && c.security !== 'none' ? ` · ${upper(c.security)}` : ''}</span></div>
            </div>
            <div className="cfg-loc">
              <span><MapPin size={16} />{locationLabel(s)}</span>
              <span className="en" dir="ltr">{s.code}</span>
              {sub ? <><span className="en"><Gauge size={16} />{gb(sub.usedBytes) ?? 0} GB{sub.quotaBytes ? ` / ${gb(sub.quotaBytes)} GB` : ''}</span>{pct != null && <Bar pct={pct} />}</> : <span className="cx-muted">بدون اشتراك</span>}
            </div>
            <div className="cfg-exp"><CalendarDays size={18} /><div><b>{dateOnly(sub?.currentPeriodEnd)}</b><small>تاريخ الانتهاء{daysRemaining(sub?.currentPeriodEnd) != null ? ` — ${num(daysRemaining(sub?.currentPeriodEnd))} يوم` : ''}</small></div></div>
            <div className="cfg-act">
              <Pill tone={statusTone(s)}>{customerStatus(s).text}</Pill>
              <div className="cfg-btns">
                <button className="cx-btn small outline-gold" onClick={() => copy(s)} disabled={!ok} title={ok ? '' : 'الرابط غير متاح لهذه الخدمة'}><Copy size={15} />نسخ الرابط</button>
                <button className="cx-btn small outline" onClick={() => showQr(s)} disabled={!ok}><QrCode size={15} />عرض QR</button>
                <button className="cx-btn small outline" onClick={() => setDetails(s)}>تفاصيل</button>
                <button className="cx-icon" onClick={() => setDetails(s)} aria-label="المزيد"><MoreHorizontal size={18} /></button>
              </div>
            </div>
          </Hud>; })}
        {!rows.length && <Hud><Empty title={services.length ? 'لا نتائج لهذا البحث' : 'لا توجد كونفيجات بعد'} text={services.length ? 'غيّر الفلاتر أو كلمة البحث.' : 'ابدأ باختيار باقة مناسبة لك.'} action={!services.length && <NavLink to="/customer/services" className="cx-btn gold">استكشف الخدمات</NavLink>} /></Hud>}
      </div>
    </AccountLayout>
    {qr && <QrModal service={qr.s} link={qr.link} onClose={() => setQr(null)} />}
    {details && <ServiceDetailsModal service={details} onClose={() => setDetails(null)} />}
  </>;
}
