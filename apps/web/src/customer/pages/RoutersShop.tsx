import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUpDown, Cable, Gauge, Laptop, Search, ShieldCheck, ShoppingCart, SlidersHorizontal, Star, Wifi } from 'lucide-react';
import { money, moneyNum, num } from '../../lib/api';
import { usePortal } from '../Portal';
import { Banner, Empty, Hud, Modal, useToast } from '../ui';
import { LandlinePicker, placeOrder } from '../checkout';

type Product = { id: string; sku: string; name: string; model: string; price_minor: number | string; currency: string; brand?: string | null; description?: string | null; image_url?: string | null; specs?: any; featured?: boolean };
const speedMbps = (s?: string) => { const m = String(s || '').match(/([\d.]+)\s*(g|m)/i); return m ? Number(m[1]) * (m[2].toLowerCase() === 'g' ? 1000 : 1) : 0; };
const SPEEDS: [string, number, number][] = [['حتى 300 Mbps', 0, 300], ['حتى 1 Gbps', 301, 1000], ['حتى 2.5 Gbps', 1001, 2500], ['أكثر من 2.5 Gbps', 2501, 1e9]];

export function RoutersShop() {
  const { routerProducts, categories, refresh } = usePortal(); const toast = useToast(); const nav = useNavigate(); const [params] = useSearchParams();
  const products: Product[] = routerProducts;
  const maxPrice = Math.max(0, ...products.map(p => Number(p.price_minor)));
  const [q, setQ] = useState(''); const [brands, setBrands] = useState<string[]>([]); const [conns, setConns] = useState<string[]>([]); const [speeds, setSpeeds] = useState<number[]>([]);
  const [priceCap, setPriceCap] = useState<number | null>(null); const [sort, setSort] = useState('featured'); const [buying, setBuying] = useState<Product | null>(null);
  useEffect(() => { const pre = products.find(p => p.id === params.get('product')); if (pre) setBuying(pre); }, [products.length]);
  const allBrands = Array.from(new Set(products.map(p => p.brand).filter(Boolean))) as string[];
  const allConns = Array.from(new Set(products.flatMap(p => String(p.specs?.connection || '').split('/').map(s => s.trim())).filter(Boolean)));
  const cap = priceCap ?? maxPrice;
  let list = products.filter(p => (!q || `${p.name} ${p.model} ${p.brand || ''}`.toLowerCase().includes(q.toLowerCase())) && (!brands.length || brands.includes(String(p.brand))) && (!conns.length || conns.some(c => String(p.specs?.connection || '').includes(c))) && (!speeds.length || speeds.some(i => { const v = speedMbps(p.specs?.speed); return v >= SPEEDS[i][1] && v <= SPEEDS[i][2]; })) && Number(p.price_minor) <= cap);
  if (sort === 'asc') list = [...list].sort((a, b) => Number(a.price_minor) - Number(b.price_minor));
  if (sort === 'desc') list = [...list].sort((a, b) => Number(b.price_minor) - Number(a.price_minor));
  const toggle = <T,>(arr: T[], v: T, set: (x: T[]) => void) => set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  return <div className="shop routers">
    {toast.node}
    <Banner art="moon" eyebrow="ROUTERS" title="الراوترات" sub="اختر الراوتر المناسب لاحتياجاتك." side={<>SOME PLACES<br />HAVE NO BORDERS.<br /><br />SEE YOU<br />SPACE COWBOY…</>} />
    <Hud className="filters">
      <label className="cx-search"><Search size={20} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="البحث في الراوترات…" aria-label="بحث" /></label>
      <label className="sel-lbl"><span><ArrowUpDown size={14} /> ترتيب حسب</span><select value={sort} onChange={e => setSort(e.target.value)}><option value="featured">الموصى به أولًا</option><option value="asc">السعر: الأقل أولًا</option><option value="desc">السعر: الأعلى أولًا</option></select></label>
    </Hud>
    <div className="router-grid">
      <Hud className="facets" as="aside">
        <div className="hud-head"><h2>الفلاتر</h2><SlidersHorizontal size={22} className="gold" /></div>
        {maxPrice > 0 && <div className="facet"><h3>السعر</h3><input type="range" min={0} max={maxPrice} step={100} value={cap} onChange={e => setPriceCap(Number(e.target.value))} aria-label="أقصى سعر" /><div className="range-lbl"><span>{moneyNum(cap)} جنيه</span><span>0 جنيه</span></div></div>}
        {allBrands.length > 0 && <div className="facet"><h3>الشركة المصنعة</h3>{allBrands.map(b => <label key={b} className="chk"><input type="checkbox" checked={brands.includes(b)} onChange={() => toggle(brands, b, setBrands)} /><span className="en">{b}</span></label>)}</div>}
        {allConns.length > 0 && <div className="facet"><h3>نوع الاتصال</h3>{allConns.map(c => <label key={c} className="chk"><input type="checkbox" checked={conns.includes(c)} onChange={() => toggle(conns, c, setConns)} /><span className="en">{c}</span></label>)}</div>}
        <div className="facet"><h3>السرعة</h3>{SPEEDS.map(([t], i) => <label key={t} className="chk"><input type="checkbox" checked={speeds.includes(i)} onChange={() => toggle(speeds, i, setSpeeds)} /><span>{t}</span></label>)}</div>
      </Hud>
      <div className="product-grid">
        {list.map(p => <Hud key={p.id} className="product" tone={p.featured ? 'gold' : 'cyan'} as="article">
          {p.featured && <span className="badge-pop"><Star size={13} />موصى به</span>}
          <div className="product-head"><div><h3 className="en">{p.name}</h3><small className="en">{p.model}</small></div>{p.brand && <span className="brand en">{p.brand}</span>}</div>
          <div className="product-body">
            <img src={p.image_url || '/bebop/router-kt.webp'} alt={p.name} loading="lazy" />
            <ul className="specs">
              {p.specs?.speed && <li><Gauge size={18} /><span className="en">{p.specs.speed}</span></li>}
              {p.specs?.bands && <li><Wifi size={18} /><span className="en">{p.specs.bands}</span></li>}
              {p.specs?.connection && <li><Cable size={18} /><span className="en">{p.specs.connection}</span></li>}
              {p.specs?.maxDevices && <li><Laptop size={18} /><span>حتى {num(p.specs.maxDevices)} أجهزة</span></li>}
              {p.specs?.protocols && <li><ShieldCheck size={18} /><span className="en">{p.specs.protocols}</span></li>}
              {!p.specs || !Object.keys(p.specs).length ? <li className="cx-muted">{p.description || 'راوتر مُجهز بنظام OpenWrt.'}</li> : null}
            </ul>
          </div>
          <div className="plan-foot"><div className="price"><b>{moneyNum(p.price_minor)}</b><small>جنيه</small></div><button className="cx-btn gold" onClick={() => setBuying(p)}><ShoppingCart size={17} />اشترِ الراوتر</button></div>
        </Hud>)}
        {!list.length && <Hud className="span-all"><Empty title={products.length ? 'لا توجد راوترات بهذه الفلاتر' : 'لا توجد راوترات متاحة حاليًا'} text={products.length ? 'خفف الفلاتر لعرض المزيد.' : 'عُد لاحقًا.'} /></Hud>}
      </div>
    </div>
    {buying && <RouterCheckout product={buying} plans={categories.filter((c: any) => c.router_compatible !== false).flatMap((c: any) => (c.plans || []).filter((p: any) => p.quotaPricingMode !== 'PER_GB').map((p: any) => ({ ...p, category: c.name })))} onClose={() => setBuying(null)} onDone={async code => { toast.ok(`تم إنشاء الطلب ${code}. سيُجهز بعد تأكيد الدفع.`); setBuying(null); await refresh(); window.setTimeout(() => nav('/customer/orders'), 1200); }} onError={toast.bad} />}
  </div>;
}

function RouterCheckout({ product, plans, onClose, onDone, onError }: { product: Product; plans: any[]; onClose: () => void; onDone: (code: string) => void; onError: (m: string) => void }) {
  const [planId, setPlanId] = useState(''); const [landline, setLandline] = useState(''); const [busy, setBusy] = useState(false);
  const plan = plans.find(p => p.id === planId);
  const total = Number(product.price_minor) + (plan ? Number(plan.priceMinor) : 0);
  const submit = async () => {
    if (plan && !landline) { onError('اختر رقمًا أرضيًا للباقة.'); return; }
    setBusy(true);
    try { const items: any[] = [{ type: 'ROUTER', routerProductId: product.id }]; if (plan) items.push({ type: 'CONFIG_NEW', planId: plan.id, landlineId: landline, useWithRouter: true }); const o = await placeOrder(items); onDone(o.public_code); }
    catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };
  return <Modal title={`شراء ${product.name}`} onClose={onClose}>
    <div className="rc">
      <label className="cx-field"><span>باقة تعمل على الراوتر (اختياري)</span><select value={planId} onChange={e => setPlanId(e.target.value)}><option value="">بدون باقة — الراوتر فقط</option>{plans.map(p => <option key={p.id} value={p.id}>{p.category} — {p.name} ({moneyNum(p.priceMinor)} جنيه)</option>)}</select></label>
      {plan && <LandlinePicker value={landline} onChange={setLandline} />}
      {plan && <p className="cx-note">تبدأ مدة الباقة عند شحن الراوتر، فلا تخسر أيامًا أثناء التوصيل.</p>}
      <div className="total"><span>الإجمالي</span><b>{money(total)}</b></div>
      <button className="cx-btn gold big block" onClick={submit} disabled={busy || (!!plan && !landline)}><ShoppingCart size={20} />{busy ? 'جارٍ إنشاء الطلب…' : 'تأكيد الطلب'}</button>
    </div>
  </Modal>;
}
