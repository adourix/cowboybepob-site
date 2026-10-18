import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUpDown, CalendarDays, Database, DollarSign, Infinity as InfinityIcon, Layers, Minus, Plus, Search, ShieldCheck, ShoppingCart, Star } from 'lucide-react';
import { gb, money, moneyNum, num } from '../../lib/api';
import { usePortal } from '../Portal';
import { Banner, Empty, Hud, useToast } from '../ui';
import { LandlinePicker, placeOrder } from '../checkout';

type Plan = { id: string; name: string; durationDays: number; priceMinor: number; currency: string; quotaBytes: number | null; quotaPricingMode?: string; quotaPricePerGbMinor?: number | null; minQuotaGb?: number | null; maxQuotaGb?: number | null; quotaStepGb?: number | null; category: string; protocol: string; description?: string | null };
const perGb = (p: Plan) => p.quotaPricingMode === 'PER_GB';
const defaultGb = (p: Plan) => Math.max(Number(p.minQuotaGb || 1), Math.round(Number(p.quotaBytes || 0) / 1073741824) || Number(p.minQuotaGb || 1));
const priceOf = (p: Plan, qty: number) => perGb(p) ? qty * Number(p.quotaPricePerGbMinor || 0) : Number(p.priceMinor);

export function ServicesShop() {
  const { categories, refresh } = usePortal(); const toast = useToast(); const nav = useNavigate(); const [params] = useSearchParams();
  const plans: Plan[] = useMemo(() => categories.flatMap((c: any) => (c.plans || []).map((p: any) => ({ ...p, category: c.name, protocol: c.protocol, description: c.description }))), [categories]);
  const [q, setQ] = useState(''); const [proto, setProto] = useState(''); const [dur, setDur] = useState(''); const [sort, setSort] = useState('default');
  const [sel, setSel] = useState<Plan | null>(null); const [qty, setQty] = useState(0); const [landline, setLandline] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (!plans.length) return; const pre = plans.find(p => p.id === params.get('plan')); const pick = pre || plans.find(perGb) || plans[0]; setSel(s => s ?? pick); }, [plans]);
  useEffect(() => { if (sel) setQty(defaultGb(sel)); }, [sel?.id]);
  const protos = Array.from(new Set(plans.map(p => p.protocol))); const durs = Array.from(new Set(plans.map(p => p.durationDays))).sort((a, b) => a - b);
  let list = plans.filter(p => (!q || `${p.name} ${p.category}`.toLowerCase().includes(q.toLowerCase())) && (!proto || p.protocol === proto) && (!dur || String(p.durationDays) === dur));
  if (sort === 'asc') list = [...list].sort((a, b) => priceOf(a, defaultGb(a)) - priceOf(b, defaultGb(b)));
  if (sort === 'desc') list = [...list].sort((a, b) => priceOf(b, defaultGb(b)) - priceOf(a, defaultGb(a)));
  const step = Number(sel?.quotaStepGb || 1), min = Number(sel?.minQuotaGb || 1), max = sel?.maxQuotaGb ? Number(sel.maxQuotaGb) : null;
  const setGb = (v: number) => { if (!sel) return; let x = Math.max(min, Math.round((v - min) / step) * step + min); if (max != null) x = Math.min(max, x); setQty(x); };
  const buy = async () => {
    if (!sel) return; if (!landline) { toast.bad('اختر رقمًا أرضيًا أولًا.'); return; }
    setBusy(true);
    try { const o = await placeOrder([{ type: 'CONFIG_NEW', planId: sel.id, landlineId: landline, quotaGb: perGb(sel) ? qty : undefined }]); toast.ok(`تم إنشاء الطلب ${o.public_code}. سيُفعّل بعد تأكيد الدفع.`); await refresh(); window.setTimeout(() => nav('/customer/orders'), 1200); }
    catch (e: any) { toast.bad(e.message); } finally { setBusy(false); }
  };
  const popular = useMemo(() => { const fixed = plans.filter(p => !perGb(p)); return fixed.length > 2 ? fixed[Math.floor(fixed.length / 2) - 1]?.id : fixed[0]?.id; }, [plans]);

  return <div className="shop">
    {toast.node}
    <Banner art="moon" title="الخدمات" sub="اختر الباقة المناسبة لاحتياجاتك، واتصل بالعالم بدون حدود." />
    <div className="shop-grid">
      <div>
        <Hud className="filters">
          <label className="cx-search"><Search size={20} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="البحث في الخدمات…" aria-label="بحث" /></label>
          <label className="sel-lbl"><span>البروتوكول</span><select value={proto} onChange={e => setProto(e.target.value)}><option value="">الكل</option>{protos.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}</select></label>
          <label className="sel-lbl"><span>المدة</span><select value={dur} onChange={e => setDur(e.target.value)}><option value="">الكل</option>{durs.map(d => <option key={d} value={d}>{num(d)} يوم</option>)}</select></label>
          <label className="sel-lbl"><span><ArrowUpDown size={14} /> ترتيب حسب</span><select value={sort} onChange={e => setSort(e.target.value)}><option value="default">الافتراضي</option><option value="asc">السعر: الأقل أولًا</option><option value="desc">السعر: الأعلى أولًا</option></select></label>
        </Hud>
        <div className="plan-grid">
          {list.map(p => { const on = sel?.id === p.id, price = priceOf(p, defaultGb(p));
            return <Hud key={p.id} className={`plan ${on ? 'on' : ''}`} tone={on ? 'gold' : p.protocol === 'vmess' ? 'violet' : 'cyan'} as="article">
              <span className="plan-proto en">{p.protocol.toUpperCase()}</span>
              <div className="plan-head">{p.id === popular && <span className="badge-pop"><Star size={13} />الأكثر شعبية</span>}<h3>{p.name}</h3><p>{p.category}</p></div>
              <dl className="plan-specs">
                <div><dt><Database size={17} />البيانات</dt><dd className={perGb(p) ? 'gold' : 'en'}>{perGb(p) ? 'مخصصة' : p.quotaBytes ? `${gb(p.quotaBytes)} GB` : 'بدون حد'}</dd></div>
                <div><dt><CalendarDays size={17} />المدة</dt><dd>{num(p.durationDays)} يوم</dd></div>
                <div><dt><ShieldCheck size={17} />البروتوكول</dt><dd className="en">{p.protocol.toUpperCase()}</dd></div>
                {perGb(p) && <div><dt><DollarSign size={17} />سعر الجيجا</dt><dd>{moneyNum(p.quotaPricePerGbMinor)} جنيه</dd></div>}
              </dl>
              <div className="plan-foot"><div className="price">{perGb(p) ? <><small>يبدأ من</small><b>{moneyNum(price)}</b></> : <b>{moneyNum(price)}</b>}<small>جنيه / {num(p.durationDays)} يوم</small></div>
                <button className="cx-btn gold" onClick={() => setSel(p)} aria-pressed={on}><ShoppingCart size={17} />{on ? 'مختارة' : 'اختر الخدمة'}</button></div>
            </Hud>; })}
          {!list.length && <Hud className="span-all"><Empty title={plans.length ? 'لا توجد باقات بهذه الفلاتر' : 'لا توجد باقات متاحة حاليًا'} text={plans.length ? 'غيّر الفلاتر لعرض باقات أخرى.' : 'عُد لاحقًا.'} /></Hud>}
        </div>
      </div>

      <aside className="checkout">
        {sel ? <Hud tone="gold" className="co">
          <div className="co-head"><span className="plan-proto en">{sel.protocol.toUpperCase()}</span><div><h2>{sel.name}</h2><p>{perGb(sel) ? 'أدخل كمية البيانات التي تناسبك' : sel.category}</p></div><span className="avail"><i />متاح الآن</span></div>
          <div className="co-tiles">
            <div><Layers size={22} /><b>{sel.category}</b><small>الفئة</small></div>
            <div>{perGb(sel) ? <InfinityIcon size={22} /> : <Database size={22} />}<b className="en">{perGb(sel) ? 'مخصص' : sel.quotaBytes ? `${gb(sel.quotaBytes)} GB` : '∞'}</b><small>البيانات</small></div>
            <div><CalendarDays size={22} /><b>{num(sel.durationDays)} يوم</b><small>المدة</small></div>
            <div><ShieldCheck size={22} /><b className="en">{sel.protocol.toUpperCase()}</b><small>البروتوكول</small></div>
          </div>
          {perGb(sel) && <div className="co-gb">
            <h3><Database size={20} />تخصيص البيانات</h3>
            <p>أدخل كمية الجيجا التي تريدها وسيتم حساب السعر تلقائيًا.</p>
            <div className="stepper">
              <button onClick={() => setGb(qty - step)} disabled={qty <= min} aria-label="إنقاص"><Minus size={20} /></button>
              <label><input type="number" dir="ltr" value={qty} min={min} max={max ?? undefined} step={step} onChange={e => setQty(Number(e.target.value) || min)} onBlur={() => setGb(qty)} aria-label="عدد الجيجا" /><span className="en">GB</span></label>
              <button onClick={() => setGb(qty + step)} disabled={max != null && qty >= max} aria-label="زيادة"><Plus size={20} /></button>
            </div>
            <small className="range">الحد المسموح: <span dir="ltr">{num(min)}{max ? ` – ${num(max)}` : '+'} GB</span>{step > 1 ? ` · بمضاعفات ${num(step)}` : ''}</small>
          </div>}
          <div className="co-price">
            <h3><DollarSign size={20} />تفاصيل السعر</h3>
            <dl>{perGb(sel) && <div><dt>سعر الجيجا الواحد</dt><dd>{moneyNum(sel.quotaPricePerGbMinor)} جنيه / GB</dd></div>}
              <div><dt>كمية البيانات</dt><dd className="en">{perGb(sel) ? `${qty} GB` : sel.quotaBytes ? `${gb(sel.quotaBytes)} GB` : '∞'}</dd></div>
              <div><dt>المدة</dt><dd>{num(sel.durationDays)} يوم</dd></div></dl>
            <div className="total"><span>السعر الإجمالي</span><b>{money(priceOf(sel, qty), sel.currency)}</b></div>
          </div>
          <LandlinePicker value={landline} onChange={setLandline} />
          <button className="cx-btn gold big block" onClick={buy} disabled={busy || !landline}><ShoppingCart size={20} />{busy ? 'جارٍ إنشاء الطلب…' : 'شراء الخدمة الآن'}</button>
          <small className="co-note">الدفع بالتحويل، ويؤكده فريقنا يدويًا قبل التفعيل.</small>
        </Hud> : <Hud><Empty title="اختر باقة" text="اضغط «اختر الخدمة» على أي باقة لعرض التفاصيل هنا." /></Hud>}
      </aside>
    </div>
  </div>;
}
