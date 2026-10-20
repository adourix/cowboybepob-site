import React, { useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ArrowLeft, Box, ChevronLeft, Copy, Download, Headphones, Layers, Link2, MoreHorizontal, QrCode, RefreshCw, Router as RouterIcon, Settings2, ShoppingCart } from 'lucide-react';
import { api, dateOnly, gb, label, money, num, shortName } from '../../lib/api';
import { usePortal } from '../Portal';
import { canRevealLink, currentConfig, customerStatus, daysRemaining, selectLeftConfigService, selectPrimaryService, usagePercent } from '../selection';
import { Banner, Bar, Empty, Hud, HudHead, Modal, Pill, Ring, useToast } from '../ui';
import { PaymentFlow } from '../PaymentFlow';
import { copyText, downloadLink, locationLabel, QrModal, ServiceDetailsModal, settingsText, statusTone, upper, useServiceLink } from '../serviceActions';

export function Dashboard() {
  const { user, services, routers, orders, loading, refresh } = usePortal();
  const nav = useNavigate(); const toast = useToast();
  // Spec §31: two independent selections, recomputed from `services` after every refetch.
  const primaryService = useMemo(() => selectPrimaryService(services), [services]);
  const leftConfigService = useMemo(() => selectLeftConfigService(services), [services]);
  const link = useServiceLink(toast.bad);
  const [modal, setModal] = useState<null | 'qr' | 'details' | 'guide'>(null); const [guide, setGuide] = useState('');
  const [qrLink, setQrLink] = useState(''); const [payOrder, setPayOrder] = useState<string | null>(null);

  // Spec §46: counts are independent of the selection.
  const activeCount = services.filter(s => s.status === 'ACTIVE').length;
  const first = shortName(user.fullName);

  const leftCfg = currentConfig(leftConfigService), canLink = canRevealLink(leftConfigService);
  const doCopy = async () => { const l = await link.reveal(leftConfigService); if (l && await copyText(l)) toast.ok('تم نسخ رابط الاشتراك'); };
  const doCopySettings = async () => { const l = await link.reveal(leftConfigService); if (l && leftConfigService && await copyText(settingsText(leftConfigService, l))) toast.ok('تم نسخ الإعدادات'); };
  const doQr = async () => { const l = await link.reveal(leftConfigService); if (l) { setQrLink(l); setModal('qr'); } };
  const doDownload = async () => { const l = await link.reveal(leftConfigService); if (l && leftConfigService) downloadLink(leftConfigService, l); };
  const renew = async () => {
    if (!primaryService) return;
    try { const o = await api<any>(`/api/v1/customer/services/${primaryService.id}/renew`, { method: 'POST', body: JSON.stringify({}) }); await refresh(); setPayOrder(o.id); }
    catch (e: any) { toast.bad(e.message); }
  };

  const sub = primaryService?.subscription, pCfg = currentConfig(primaryService);
  const days = daysRemaining(sub?.currentPeriodEnd), pct = usagePercent(sub?.usedBytes, sub?.quotaBytes);
  const totalDays = primaryService?.durationDays || 30;
  const router = primaryService?.router ?? null;

  return <div className="dash">
    {toast.node}
    <Banner art="cockpit" eyebrow="WELCOME BACK" title={<>مرحبًا، {first}</>} sub="إليك نظرة سريعة على خدماتك وحسابك." side={<>SOME PLACES<br />HAVE NO BORDERS.<br /><br />SEE YOU<br />SPACE COWBOY…</>}>
      <div className="banner-stats">
        <Hud tone="red" className="mini-stat"><Layers size={34} /><div><span>الخدمات النشطة</span><b>{loading ? '…' : num(activeCount)}</b><small>من أصل {num(services.length)}</small></div></Hud>
        <Hud tone="green" className="mini-stat"><RouterIcon size={34} /><div><span>الراوترات</span><b>{loading ? '…' : num(routers.length)}</b><small>{num(routers.filter(r => r.connectivity === 'ONLINE').length)} متصل</small></div></Hud>
        <Hud tone="gold" className="mini-stat"><Box size={34} /><div><span>الطلبات</span><b>{loading ? '…' : num(orders.length)}</b><small>إجمالي الطلبات</small></div></Hud>
      </div>
    </Banner>

    {!loading && services.length === 0 ? <Hud className="dash-empty"><Empty title="لا توجد خدمات بعد" text="ابدأ باختيار باقة مناسبة لك." action={<NavLink to="/customer/services" className="cx-btn gold">استكشف الخدمات</NavLink>} /></Hud> :
    <div className="dash-grid">
      {/* ── Left column: CONFIG ACCESS (independent rule) + setup guide */}
      <div className="dash-col">
        <Hud className="cfg-access">
          <HudHead title="الوصول إلى الإعدادات" en="CONFIG ACCESS" />
          {leftConfigService ? <>
            <Pill tone={statusTone(leftConfigService)}>{customerStatus(leftConfigService).text}</Pill>
            <div className="proto"><b className="en">{upper(leftCfg?.protocol)}</b>{leftCfg?.security && leftCfg.security !== 'none' && <span className="tag en">{upper(leftCfg.security)}</span>}</div>
            <div className="cfg-meta en" dir="ltr">{leftConfigService.code}{leftConfigService.location ? ` · ${leftConfigService.location.city || ''}` : ''}</div>
            {leftConfigService.status === 'PROVISIONING' ? <div className="cx-note">جارٍ تجهيز الخدمة. سيظهر الرابط تلقائيًا عند التفعيل.</div>
              : <button className="cx-btn red block" onClick={doCopy} disabled={!canLink || link.busy === leftConfigService.id}><Link2 size={18} />{canLink ? 'نسخ رابط الاشتراك' : 'الرابط غير متاح لهذه الخدمة'}</button>}
            <div className="cfg-tools">
              <button onClick={doCopySettings} disabled={!canLink}><Settings2 size={22} /><span>نسخ الإعدادات</span></button>
              <button onClick={doDownload} disabled={!canLink}><Download size={22} /><span>تحميل ملف</span></button>
              <button onClick={doQr} disabled={!canLink} title={canLink ? '' : 'لا يوجد رابط متاح لعرض QR'}><QrCode size={22} /><span>عرض QR</span></button>
              <button onClick={() => setModal('details')}><MoreHorizontal size={22} /><span>المزيد</span></button>
            </div>
          </> : <Empty title="لا يوجد كونفيج بعد" />}
        </Hud>
        <Hud className="guide">
          <HudHead title="دليل الإعدادات السريع" en="SETUP GUIDE" />
          <div className="guide-tiles">{GUIDES.map(g => <button key={g.key} onClick={() => { setGuide(g.key); setModal('guide'); }}><span className={`os os-${g.key}`} aria-hidden>{g.icon}</span><b className="en">{g.name}</b></button>)}</div>
        </Hud>
      </div>

      {/* ── Centre: PRIMARY SERVICE usage + router + recent orders */}
      <div className="dash-col">
        <Hud className="usage">
          <HudHead title="استهلاك النت الشهري" action={primaryService && <span className="usage-code en" dir="ltr">{primaryService.code}</span>} />
          {primaryService && <div className="usage-name">{primaryService.label || primaryService.categoryName}</div>}
          {!primaryService ? null : primaryService.status === 'PROVISIONING' ? <div className="cx-note big">جارٍ تجهيز الخدمة. ستبدأ مدة الاشتراك عند التفعيل.</div> : <div className="usage-body">
            <div className="ring-col"><Ring value={days ?? 0} max={totalDays}><small>يتبقى خلال</small><b>{days == null ? '—' : num(days)}</b><small>يومًا</small></Ring><div className="ring-exp">تاريخ الانتهاء<b>{dateOnly(sub?.currentPeriodEnd)}</b></div></div>
            <div className="usage-nums">
              <span className="lbl">المستخدم في هذه الفترة</span>
              <div className="big-num"><b className="en">{gb(sub?.usedBytes) ?? 0} GB</b>{sub?.quotaBytes ? <small className="en">/ {gb(sub.quotaBytes)} GB</small> : <small>بدون حد</small>}</div>
              {pct != null && <div className="usage-bar"><Bar pct={pct} /><span className="en">{Math.round(pct)}%</span></div>}
              <div className="usage-split">
                <div><span>المتبقي</span><b className="en">{sub?.quotaBytes ? `${Math.max(0, Math.round(((gb(sub.quotaBytes) || 0) - (gb(sub.usedBytes) || 0)) * 10) / 10)} GB` : '∞'}</b></div>
                <div><span>حالة الاشتراك</span><b>{sub?.status === 'EXPIRED' ? 'منتهٍ' : sub?.status === 'ACTIVE' ? 'نشط' : sub ? 'لم يبدأ' : 'بدون اشتراك'}</b></div>
              </div>
              {sub?.usageSyncedAt && <small className="sync">آخر تحديث للاستهلاك: {new Date(sub.usageSyncedAt).toLocaleString('ar-EG', { timeStyle: 'short', dateStyle: 'short' })}</small>}
            </div>
          </div>}
        </Hud>

        <Hud className="home-router" tone={router ? 'cyan' : 'cyan'}>
          <HudHead title="الراوتر المنزلي" action={router?.code && <span className="en code" dir="ltr">#{router.code}</span>} />
          {router ? <div className="router-body">
            <img src="/bebop/router-kt.webp" alt="" />
            <div className="router-spec">
              <small className="en">NETWORK DEVICE</small>
              <b className="en">{router.model || 'Router'}</b>
              <dl>
                <div><dt className="en">STATUS</dt><dd className={router.connectivity === 'ONLINE' ? 'on' : router.connectivity === 'OFFLINE' ? 'off' : ''}>{label(router.connectivity || 'UNKNOWN')}</dd></div>
                <div><dt className="en">LIFECYCLE</dt><dd>{label(router.status)}</dd></div>
                <div><dt className="en">SERVICE</dt><dd dir="ltr">{primaryService?.code}</dd></div>
              </dl>
            </div>
          </div> : <Empty title="لا يوجد راوتر مرتبط" text="اشترِ راوترًا مُجهزًا ليعمل الاشتراك على كل أجهزة البيت." action={<NavLink to="/customer/routers" className="cx-btn gold">شراء راوتر</NavLink>} />}
        </Hud>

        <Hud className="recent">
          <HudHead title="آخر الطلبات" en="RECENT ORDERS" action={<NavLink to="/customer/orders" className="cx-link">عرض جميع الطلبات <ChevronLeft size={16} /></NavLink>} />
          {orders.length ? <div className="table-scroll"><table className="cx-table"><thead><tr><th>#</th><th>المنتج</th><th>الحالة</th><th>المبلغ</th><th>التاريخ</th></tr></thead><tbody>
            {orders.slice(0, 3).map(o => <tr key={o.id}><td className="en" dir="ltr">{o.public_code}</td><td>{o.items?.[0]?.name}{o.items?.length > 1 ? ` +${o.items.length - 1}` : ''}</td><td><Pill tone={o.status === 'COMPLETED' ? 'ok' : o.status === 'CANCELLED' ? 'bad' : 'warn'}>{label(o.status)}</Pill></td><td>{money(o.total_minor, o.currency)}</td><td>{dateOnly(o.placed_at)}</td></tr>)}
          </tbody></table></div> : <p className="cx-muted">لا توجد طلبات بعد.</p>}
        </Hud>
      </div>

      {/* ── Right: SERVICE DETAILS (same primary service) + quick actions + explore */}
      <div className="dash-col">
        <Hud className="details">
          <HudHead title="تفاصيل الخدمة" action={primaryService && <Pill tone={statusTone(primaryService)}>{customerStatus(primaryService).text}</Pill>} />
          {primaryService && <dl className="kv">
            <div><dt>الخدمة</dt><dd dir="ltr">{primaryService.code}</dd></div>
            <div><dt>البروتوكول</dt><dd className="en">{upper(pCfg?.protocol)}</dd></div>
            <div><dt>الأمان</dt><dd className="en">{upper(pCfg?.security)}</dd></div>
            <div><dt>الموقع</dt><dd>{locationLabel(primaryService)}</dd></div>
            <div><dt>الباقة</dt><dd>{primaryService.planName || '—'}</dd></div>
            <div><dt>تاريخ الإنشاء</dt><dd>{dateOnly(primaryService.createdAt)}</dd></div>
          </dl>}
        </Hud>
        <Hud className="quick">
          <HudHead title="إجراءات سريعة" en="QUICK ACTIONS" />
          <div className="quick-grid">
            <button onClick={renew} disabled={!primaryService?.planId || primaryService.status === 'TERMINATED'}><RefreshCw size={22} />تجديد الخدمة</button>
            <button onClick={() => nav('/customer/routers')}><ShoppingCart size={22} />إضافة راوتر</button>
            <button onClick={() => nav('/customer/services')}><Layers size={22} />شراء باقة</button>
            <button onClick={() => nav('/customer/orders')}><Box size={22} />طلباتي</button>
          </div>
        </Hud>
        <Hud className="explore">
          <img src="/bebop/planet-ring.webp" alt="" />
          <div><h2>استكشف عالمنا</h2><p>باقات أكثر، اتصال أكثر استقرارًا أينما كنت.</p><NavLink to="/customer/services" className="cx-btn ghost">عرض المزيد <ArrowLeft size={16} /></NavLink></div>
        </Hud>
      </div>
    </div>}

    {payOrder && <PaymentFlow orderId={payOrder} onClose={() => setPayOrder(null)} onDone={() => void refresh()} />}
    {modal === 'qr' && leftConfigService && <QrModal service={leftConfigService} link={qrLink} onClose={() => setModal(null)} />}
    {modal === 'details' && leftConfigService && <ServiceDetailsModal service={leftConfigService} onClose={() => setModal(null)} />}
    {modal === 'guide' && <Modal title={`الإعداد على ${GUIDES.find(g => g.key === guide)?.name}`} onClose={() => setModal(null)}><GuideBody k={guide} /></Modal>}
  </div>;
}

const GUIDES = [
  { key: 'windows', name: 'Windows', icon: '⊞' },
  { key: 'android', name: 'Android', icon: '◉' },
  { key: 'ios', name: 'iOS', icon: '' },
  { key: 'openwrt', name: 'OpenWrt', icon: '⌁' },
];
function GuideBody({ k }: { k: string }) {
  if (k === 'openwrt') return <ol className="steps"><li>راوترات CowboyBepob تصلك مُجهزة بالكامل، ولا تحتاج إعدادًا يدويًا.</li><li>صِل الراوتر بالكهرباء وبمصدر الإنترنت، وانتظر دقيقتين.</li><li>حالة الراوتر تظهر في بطاقة «الراوتر المنزلي» عند اتصاله.</li></ol>;
  const app = { windows: 'v2rayN أو Hiddify', android: 'v2rayNG أو Hiddify', ios: 'Streisand أو V2Box' }[k] || '';
  return <ol className="steps"><li>ثبّت تطبيقًا يدعم VLESS/VMess مثل {app}.</li><li>من بطاقة «الوصول إلى الإعدادات» اضغط «نسخ رابط الاشتراك» أو «عرض QR».</li><li>في التطبيق اختر «استيراد من الحافظة» أو امسح رمز QR، ثم اضغط اتصال.</li></ol>;
}
