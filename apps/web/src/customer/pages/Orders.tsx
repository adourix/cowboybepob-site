import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Box, CalendarDays, Check, CheckCircle2, Clock3, FileText, LayoutGrid, RotateCcw, Router as RouterIcon, Send, Tag, Truck, X, XCircle } from 'lucide-react';
import { api, dateOnly, label, money, num } from '../../lib/api';
import { usePortal } from '../Portal';
import { Banner, Empty, Hud, Modal, Pill, useToast } from '../ui';
import { PAY_STATUS, PaymentFlow } from '../PaymentFlow';

type Step = { key: string; title: string; done: boolean; current: boolean; icon: React.ReactNode };
const isRouterOrder = (o: any) => (o.items || []).some((i: any) => i.type === 'ROUTER');
const orderKind = (o: any) => { const r = (o.items || []).some((i: any) => i.type === 'ROUTER'), c = (o.items || []).some((i: any) => i.type !== 'ROUTER'); return r && c ? 'bundle' : r ? 'router' : 'config'; };
const bucket = (o: any) => o.status === 'CANCELLED' || o.status === 'REFUNDED' ? 'cancelled' : o.status === 'COMPLETED' ? 'delivered' : o.status === 'SHIPPED' ? 'shipping' : 'processing';

/** Timeline derived from order status + item fulfillment (no tracking data is invented). */
export function orderSteps(o: any): Step[] {
  const paid = !!o.paid_at || ['PAID', 'FULFILLING', 'SHIPPED', 'COMPLETED'].includes(o.status);
  const router = isRouterOrder(o);
  const prepared = o.status === 'SHIPPED' || o.status === 'COMPLETED' || (o.items || []).every((i: any) => ['FULFILLED', 'READY_TO_SHIP', 'SHIPPED'].includes(i.status));
  const shipped = o.status === 'SHIPPED' || o.status === 'COMPLETED';
  const done = o.status === 'COMPLETED';
  const list = router
    ? [['placed', 'تم تأكيد الطلب', true, <Check size={16} />], ['paid', 'تم الدفع', paid, <Check size={16} />], ['ship', 'في الطريق', shipped, <Truck size={16} />], ['done', 'تم التسليم', done, <CheckCircle2 size={16} />]]
    : [['placed', 'تم تأكيد الطلب', true, <Check size={16} />], ['paid', 'تم الدفع', paid, <Check size={16} />], ['prep', 'قيد التجهيز', prepared, <Box size={16} />], ['done', 'تم التفعيل', done, <CheckCircle2 size={16} />]];
  const firstOpen = list.findIndex(x => !x[2]);
  return list.map((x, i) => ({ key: x[0] as string, title: x[1] as string, done: x[2] as boolean, current: o.status !== 'CANCELLED' && i === firstOpen, icon: x[3] as React.ReactNode }));
}

export function OrdersPage() {
  const { orders, refresh } = usePortal(); const toast = useToast(); const nav = useNavigate();
  const [tab, setTab] = useState('all'); const [view, setView] = useState<any>(null); const [payOrder, setPayOrder] = useState<string | null>(null);
  const TABS: [string, string, React.ReactNode][] = [['all', 'جميع الطلبات', <LayoutGrid size={18} />], ['config', 'الكونفيجات', <FileText size={18} />], ['router', 'الراوترات', <RouterIcon size={18} />], ['processing', 'قيد المعالجة', <Clock3 size={18} />], ['shipping', 'قيد الشحن', <Truck size={18} />], ['delivered', 'مكتملة', <CheckCircle2 size={18} />], ['cancelled', 'ملغاة', <X size={18} />]];
  const rows = orders.filter(o => tab === 'all' || (tab === 'config' && orderKind(o) !== 'router') || (tab === 'router' && orderKind(o) !== 'config') || bucket(o) === tab);
  const count = (b: string) => orders.filter(o => bucket(o) === b).length;
  const cancel = async (o: any) => { if (!confirm(`إلغاء الطلب ${o.public_code}؟`)) return; try { await api(`/api/v1/customer/orders/${o.id}/cancel`, { method: 'POST', body: JSON.stringify({}) }); toast.ok('تم إلغاء الطلب'); await refresh(); } catch (e: any) { toast.bad(e.message); } };
  const reorder = (o: any) => { const it = (o.items || []).find((i: any) => i.planId || i.routerProductId); if (!it) return; nav(it.routerProductId ? `/customer/routers?product=${it.routerProductId}` : `/customer/services?plan=${it.planId}`); };

  return <div className="orders-page">
    {toast.node}
    <Banner art="moon" eyebrow="ORDERS" title="طلباتي" sub="تابع حالة طلباتك ومعلوماتها بسهولة." />
    <div className="orders-grid">
      <div>
        <Hud className="tabs-bar"><div className="tab-row" role="tablist">{TABS.map(([k, t, i]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{i}{t}</button>)}</div></Hud>
        <div className="order-list">
          {rows.map(o => { const kind = orderKind(o), steps = orderSteps(o), first = o.items?.[0];
            return <Hud key={o.id} className="order-row" tone={o.status === 'CANCELLED' ? 'red' : 'cyan'}>
              <div className={`order-thumb k-${kind}`}>{kind === 'config' ? <Send size={42} /> : <img src="/bebop/router-kt.webp" alt="" />}<span className="en">{kind === 'bundle' ? 'ROUTER+CONFIG' : kind === 'router' ? 'ROUTER' : 'CONFIG'}</span></div>
              <div className="order-meta"><b className="en" dir="ltr">#{o.public_code}</b><span><CalendarDays size={15} />{dateOnly(o.placed_at)}</span><span className="price"><Tag size={15} />{money(o.total_minor, o.currency)}</span></div>
              <div className="order-what"><b>{first?.name}</b><small>{kind === 'config' ? 'اشتراك كونفيج' : kind === 'router' ? 'راوتر' : 'راوتر + كونفيج'}{o.items?.length > 1 ? ` — ${num(o.items.length)} عناصر` : ''}</small>{first?.quotaGb && <small className="en">{first.quotaGb} GB</small>}</div>
              {o.status === 'CANCELLED' ? <div className="timeline cancelled"><XCircle size={26} />تم إلغاء الطلب {o.cancelled_at ? `— ${dateOnly(o.cancelled_at)}` : ''}</div> :
                <ol className="timeline">{steps.map(s => <li key={s.key} className={(s.done ? 'done' : '') + (s.current ? ' current' : '')}><span className="dot">{s.done ? <Check size={16} /> : s.icon}</span><small>{s.title}</small></li>)}</ol>}
              <div className="order-act">
                <button className="cx-btn small outline-gold" onClick={() => setView(o)}>عرض التفاصيل</button>
                {o.status === 'PENDING_PAYMENT' && <button className="cx-btn small gold" onClick={() => setPayOrder(o.id)}>{['PENDING_VERIFICATION', 'AUTO_VERIFIED'].includes(o.payment_status) ? 'حالة الدفع' : 'ادفع الآن'}</button>}
                {o.payment_status && PAY_STATUS[o.payment_status] && o.status !== 'COMPLETED' && <span className={`pay-chip t-${['PENDING_VERIFICATION', 'AUTO_VERIFIED'].includes(o.payment_status) && o.status !== 'PENDING_PAYMENT' ? 'ok' : PAY_STATUS[o.payment_status][1]}`}>{['PENDING_VERIFICATION', 'AUTO_VERIFIED'].includes(o.payment_status) && o.status !== 'PENDING_PAYMENT' ? 'مفعّل لحين مراجعة الدفع' : PAY_STATUS[o.payment_status][0]}</span>}
                {o.status === 'PENDING_PAYMENT' && !['PENDING_VERIFICATION', 'AUTO_VERIFIED'].includes(o.payment_status) ? <button className="cx-btn small outline-red" onClick={() => cancel(o)}><X size={15} />إلغاء الطلب</button>
                  : o.status === 'SHIPPED' ? <button className="cx-btn small outline" onClick={() => setView(o)}><Truck size={15} />تتبع الشحنة</button>
                  : o.status === 'COMPLETED' ? <span className="done-chip"><Check size={15} />{kind === 'config' ? 'تم التفعيل' : 'تم التسليم'}</span>
                  : (o.items || []).some((i: any) => i.planId || i.routerProductId) && o.status === 'CANCELLED' ? <button className="cx-btn small outline" onClick={() => reorder(o)}><RotateCcw size={15} />إعادة الشراء</button>
                  : <span className="cx-muted small">{label(o.status)}</span>}
              </div>
            </Hud>; })}
          {!rows.length && <Hud><Empty title={orders.length ? 'لا توجد طلبات في هذا التصنيف' : 'لا توجد طلبات بعد'} action={!orders.length && <button className="cx-btn gold" onClick={() => nav('/customer/services')}>تصفح الخدمات</button>} /></Hud>}
        </div>
      </div>
      <aside className="orders-side">
        <Hud className="o-stats"><div className="hud-head"><h2>إحصائيات طلباتك</h2><BarChart3 size={24} className="gold" /></div>
          <div className="o-stat-grid">
            <div><CheckCircle2 size={28} className="ok" /><b>{num(count('delivered'))}</b><span>مكتملة</span></div>
            <div><Box size={28} className="gold" /><b>{num(orders.length)}</b><span>إجمالي الطلبات</span></div>
            <div><Clock3 size={28} className="gold" /><b>{num(count('processing'))}</b><span>قيد المعالجة</span></div>
            <div><Truck size={28} className="gold" /><b>{num(count('shipping'))}</b><span>قيد الشحن</span></div>
            <div><XCircle size={28} className="bad" /><b>{num(count('cancelled'))}</b><span>ملغاة</span></div>
          </div>
        </Hud>
        <Hud className="o-note"><h2>كيف يتم الدفع؟</h2><p>بعد إنشاء الطلب حوّل المبلغ، وسيؤكد فريقنا الدفع يدويًا. يبدأ التجهيز تلقائيًا بعد التأكيد.</p></Hud>
        <Hud className="o-art"><img src="/bebop/planet-ring.webp" alt="" /></Hud>
      </aside>
    </div>
    {payOrder && <PaymentFlow orderId={payOrder} onClose={() => { setPayOrder(null); void refresh(); }} onDone={() => void refresh()} />}
    {view && <Modal title={`الطلب ${view.public_code}`} onClose={() => setView(null)} wide>
      <dl className="kv">
        <div><dt>الحالة</dt><dd><Pill tone={view.status === 'COMPLETED' ? 'ok' : view.status === 'CANCELLED' ? 'bad' : 'warn'}>{label(view.status)}</Pill></dd></div>
        <div><dt>تاريخ الطلب</dt><dd>{dateOnly(view.placed_at)}</dd></div>
        <div><dt>الدفع</dt><dd>{view.paid_at ? `مؤكد — ${dateOnly(view.paid_at)}` : view.payment_status && PAY_STATUS[view.payment_status] ? PAY_STATUS[view.payment_status][0] : 'لم يبدأ'}</dd></div>
        <div><dt>الإجمالي</dt><dd>{money(view.total_minor, view.currency)}</dd></div>
      </dl>
      <h3 className="sub-h">العناصر</h3>
      <table className="cx-table"><thead><tr><th>العنصر</th><th>النوع</th><th>السعر</th><th>الحالة</th></tr></thead><tbody>
        {(view.items || []).map((i: any, n: number) => <tr key={n}><td>{i.name}{i.quotaGb ? <small className="en"> · {i.quotaGb} GB</small> : null}</td><td>{i.type === 'ROUTER' ? 'راوتر' : i.type === 'CONFIG_RENEWAL' ? 'تجديد' : 'كونفيج'}</td><td>{money(i.priceMinor, view.currency)}</td><td>{label(i.status)}{i.detail === 'NO_CAPACITY' ? ' — بانتظار سعة' : i.detail === 'NO_ROUTER_STOCK' ? ' — بانتظار توفر راوتر' : ''}</td></tr>)}
      </tbody></table>
      {isRouterOrder(view) && view.status === 'SHIPPED' && <p className="cx-note">تم شحن الراوتر. سيتواصل معك المندوب على رقم موبايلك عند الوصول.</p>}
    </Modal>}
  </div>;
}
