import React, { useEffect, useRef, useState } from 'react';
import { Apple, CheckCircle2, Clock3, CreditCard, ImageUp, Loader2, ShieldCheck, Smartphone, XCircle } from 'lucide-react';
import { api, moneyNum } from '../lib/api';
import { copyText, Modal } from './ui';

type Method = 'VODAFONE_CASH' | 'ORANGE_CASH' | 'CARD' | 'APPLE_PAY';
type Options = { orderId: string; orderCode: string; amountMinor: number; currency: string; gatewayMinMinor: number; methods: { method: Method; available: boolean; reason: string | null }[]; openPayment: any };

/** Customer-facing wording only. The backend decides; this never shows success before PAID. */
export const PAY_STATUS: Record<string, [string, 'ok' | 'warn' | 'bad' | 'idle' | 'info']> = {
  AWAITING_TRANSFER: ['بانتظار التحويل', 'warn'], PENDING_VERIFICATION: ['جارٍ التحقق من الدفع…', 'info'], AUTO_VERIFIED: ['تم التحقق مبدئيًا — الخدمة مفعّلة لحين مراجعة المحاسب', 'info'],
  PAID: ['تم الدفع', 'ok'], REJECTED: ['رُفض الدفع', 'bad'], EXPIRED: ['انتهت مهلة الدفع', 'idle'], REVIEW_EXPIRED: ['انتهت مهلة المراجعة — تواصل معنا', 'bad'],
  CREATED: ['جارٍ فتح صفحة الدفع', 'info'], CHECKOUT_STARTED: ['بانتظار إتمام الدفع', 'warn'], PROCESSING: ['جارٍ معالجة الدفع', 'info'], FAILED: ['فشل الدفع', 'bad'], CANCELLED: ['أُلغي الدفع', 'idle'],
};
const METHOD_UI: Record<Method, { title: string; sub: string; icon: React.ReactNode }> = {
  VODAFONE_CASH: { title: 'فودافون كاش', sub: 'حوّل من محفظتك ثم أرسل الإيصال', icon: <Smartphone size={22} /> },
  ORANGE_CASH: { title: 'أورنج كاش', sub: 'حوّل من أي محفظة إلى رقم أورنج كاش', icon: <Smartphone size={22} /> },
  CARD: { title: 'Visa / Mastercard', sub: 'دفع آمن عبر Kashier', icon: <CreditCard size={22} /> },
  APPLE_PAY: { title: 'Apple Pay', sub: 'عبر Kashier من أجهزة Apple', icon: <Apple size={22} /> },
};

export function PaymentFlow({ orderId, onClose, onDone }: { orderId: string; onClose: () => void; onDone?: () => void }) {
  const [opts, setOpts] = useState<Options | null>(null); const [method, setMethod] = useState<Method>('VODAFONE_CASH');
  const [vc, setVc] = useState<any>(null); const [payment, setPayment] = useState<any>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { void api<Options>(`/api/v1/customer/orders/${orderId}/payment-options`).then(o => {
    setOpts(o);
    if (o.openPayment && ['PENDING_VERIFICATION', 'AUTO_VERIFIED', 'PROCESSING'].includes(o.openPayment.status)) void api(`/api/v1/customer/payments/${o.openPayment.id}`).then(setPayment);
  }).catch(e => setErr(e.message)); }, [orderId]);

  const start = async () => {
    setErr(''); setBusy(true);
    try {
      const r = await api<any>(`/api/v1/customer/orders/${orderId}/payments`, { method: 'POST', body: JSON.stringify({ method }) });
      if (r.action.type === 'REDIRECT') { window.location.assign(r.action.url); return; } // Kashier hosted checkout; card data never touches our site
      setVc({ ...r.action, paymentId: r.payment.id });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const minEgp = opts ? moneyNum(opts.gatewayMinMinor) : '75';
  return <Modal title={opts ? `دفع الطلب ${opts.orderCode}` : 'الدفع'} onClose={onClose} wide>
    {!opts ? <p className="cx-muted">{err || 'جارٍ التحميل…'}</p>
      : payment ? <PaymentStatus initial={payment} onDone={() => { onDone?.(); }} />
      : vc ? <VodafoneStep action={vc} amountMinor={opts.amountMinor} onSubmitted={p => setPayment(p)} />
      : <div className="payflow">
        <div className="pay-amount"><span>المبلغ المطلوب</span><b>{moneyNum(opts.amountMinor)} <small>جنيه</small></b></div>
        <div className="pay-methods" role="radiogroup" aria-label="طريقة الدفع">
          {opts.methods.map(m => { const ui = METHOD_UI[m.method]; const below = m.reason === 'BELOW_GATEWAY_MINIMUM';
            if (below && m.method !== 'VODAFONE_CASH') return null; // card/Apple Pay are not offered under the minimum
            return <label key={m.method} className={`pay-method ${method === m.method ? 'on' : ''} ${!m.available ? 'off' : ''}`}>
              <input type="radio" name="pm" checked={method === m.method} disabled={!m.available} onChange={() => setMethod(m.method)} />
              <span className="pm-ico">{ui.icon}</span><span><b>{ui.title}</b><small>{m.available ? ui.sub : m.reason === 'GATEWAY_NOT_CONFIGURED' ? 'غير متاح حاليًا' : 'غير متاح'}</small></span>
            </label>; })}
        </div>
        {opts.amountMinor < opts.gatewayMinMinor && <p className="cx-note">الدفع بالبطاقة و Apple Pay متاح للطلبات من {minEgp} جنيه فأكثر.</p>}
        {err && <div className="cx-alert bad">{err}</div>}
        <button className="cx-btn gold big block" onClick={start} disabled={busy}>{busy ? <Loader2 size={18} className="spin" /> : <ShieldCheck size={18} />}{method === 'VODAFONE_CASH' || method === 'ORANGE_CASH' ? 'متابعة' : method === 'APPLE_PAY' ? 'الدفع بـ Apple Pay' : 'الدفع بالبطاقة'}</button>
      </div>}
  </Modal>;
}

function VodafoneStep({ action, amountMinor, onSubmitted }: { action: any; amountMinor: number; onSubmitted: (p: any) => void }) {
  const [wallet, setWallet] = useState(''); const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [copied, setCopied] = useState(false);
  const pick = (f: File | null) => {
    setErr(''); if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { setErr('الصيغ المسموحة: JPG أو PNG أو WebP.'); return; }
    if (f.size > 4 * 1024 * 1024) { setErr('حجم الصورة يجب ألا يتجاوز 4 ميجابايت.'); return; }
    setFile(f); setPreview(URL.createObjectURL(f));
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!file) { setErr('ارفع صورة إيصال التحويل.'); return; }
    setBusy(true); setErr('');
    try {
      const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('تعذر قراءة الصورة')); r.readAsDataURL(file); });
      onSubmitted(await api(`/api/v1/customer/payments/${action.paymentId}/manual-proof`, { method: 'POST', body: JSON.stringify({ senderWallet: wallet, screenshot: { mime: file.type, data } }) }));
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return <form className="payflow" onSubmit={submit}>
    <ol className="vc-steps">
      <li><b>حوّل المبلغ بالضبط</b><div className="vc-box"><span>المبلغ</span><strong>{moneyNum(amountMinor)} جنيه</strong></div></li>
      <li><b>{action.method === 'ORANGE_CASH' ? 'إلى محفظة أورنج كاش' : 'إلى محفظة فودافون كاش'}</b><div className="vc-box"><span dir="ltr" className="wallet">{action.receivingWallet}</span><button type="button" className="cx-btn small outline" onClick={async () => { if (await copyText(action.receivingWallet)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}>{copied ? 'تم النسخ' : 'نسخ الرقم'}</button></div><small className="cx-muted">رقم الطلب: <span dir="ltr">{action.orderCode}</span> · حوّل خلال المهلة: حتى {new Date(action.expiresAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</small></li>
      <li><b>اكتب رقم المحفظة التي حوّلت منها وارفع صورة الإيصال</b>
        <label className="cx-field"><span>رقم محفظتك</span><input dir="ltr" inputMode="tel" placeholder="01012345678" value={wallet} onChange={e => setWallet(e.target.value)} required /></label>
        <label className="upload"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => pick(e.target.files?.[0] || null)} />{preview ? <img src={preview} alt="معاينة الإيصال" /> : <><ImageUp size={26} /><span>اختر صورة الإيصال</span></>}</label>
      </li>
    </ol>
    <p className="cx-note">نتحقق من الدفع تلقائيًا من رسالة التحويل التي تصل لمحفظتنا، ثم يراجعه المحاسب. الصورة للمساعدة فقط.</p>
    {err && <div className="cx-alert bad">{err}</div>}
    <button className="cx-btn gold big block" disabled={busy}>{busy ? <Loader2 size={18} className="spin" /> : null}{busy ? 'جارٍ الإرسال…' : 'أرسلت المبلغ — تحقق من الدفع'}</button>
  </form>;
}

export function PaymentStatus({ initial, onDone }: { initial: any; onDone?: () => void }) {
  const [p, setP] = useState(initial); const doneRef = useRef(false);
  useEffect(() => {
    const final = ['PAID', 'REJECTED', 'EXPIRED', 'REVIEW_EXPIRED', 'FAILED', 'CANCELLED'];
    if (final.includes(p.status)) { if (!doneRef.current) { doneRef.current = true; onDone?.(); } return; }
    const t = window.setTimeout(() => void api(`/api/v1/customer/payments/${p.id}`).then(setP).catch(() => { }), 5000);
    return () => window.clearTimeout(t);
  }, [p]);
  const live = p.provisionalActivation && ['PENDING_VERIFICATION', 'AUTO_VERIFIED'].includes(p.status);
  const [text, tone] = live ? ['تم استلام بيانات الدفع — خدمتك تعمل الآن', 'ok'] as [string, 'ok'] : (PAY_STATUS[p.status] || [p.status, 'idle']);
  const icon = tone === 'ok' ? <CheckCircle2 size={56} /> : tone === 'bad' ? <XCircle size={56} /> : p.status === 'AWAITING_TRANSFER' || p.status === 'CHECKOUT_STARTED' ? <Clock3 size={56} /> : <Loader2 size={56} className="spin" />;
  return <div className={`pay-status t-${tone}`} role="status" aria-live="polite">
    {icon}<h3>{text}</h3>
    {live && <p>الكونفيج مفعّل الآن، ويراجع المحاسب التحويل قبل {p.reviewExpiresAt ? new Date(p.reviewExpiresAt).toLocaleString('ar-EG', { weekday: 'long', hour: '2-digit', minute: '2-digit' }) : 'مرور 24 ساعة'}. إذا لم يتم تأكيد التحويل يتوقف الكونفيج تلقائيًا.</p>}
    {!live && p.status === 'PENDING_VERIFICATION' && <p>استلمنا بيانات الدفع، وسيتم تفعيل الطلب بعد مراجعة المحاسب للتحويل. ستجد الحالة في «طلباتي».</p>}
    {!live && p.status === 'AUTO_VERIFIED' && <p>تم العثور على تحويلك، ويؤكد المحاسب الدفع قريبًا.</p>}
    {p.status === 'PAID' && <p>شكرًا لك! يتم تجهيز طلبك الآن.</p>}
    {['REJECTED', 'REVIEW_EXPIRED'].includes(p.status) && <p>لم نتمكن من تأكيد الدفع. إذا كنت حوّلت المبلغ، تواصل معنا ومعك رقم الطلب.</p>}
    <dl className="kv small"><div><dt>المبلغ</dt><dd>{moneyNum(p.amountMinor)} جنيه</dd></div><div><dt>الطريقة</dt><dd>{p.method === 'VODAFONE_CASH' ? 'فودافون كاش' : p.method === 'ORANGE_CASH' ? 'أورنج كاش' : p.method === 'APPLE_PAY' ? 'Apple Pay' : 'بطاقة'}</dd></div></dl>
  </div>;
}

/** Kashier redirects here. Redirect parameters are display-only; the webhook decides. */
export function PaymentReturn() {
  const id = new URLSearchParams(window.location.search).get('paymentId') || '';
  const [p, setP] = useState<any>(null); const [err, setErr] = useState('');
  useEffect(() => { if (!/^[0-9a-f-]{36}$/i.test(id)) { setErr('رابط غير صالح'); return; } void api(`/api/v1/customer/payments/${id}`).then(setP).catch(e => setErr(e.message)); }, [id]);
  return <div className="pay-return">{err ? <div className="cx-alert bad">{err}</div> : p ? <PaymentStatus initial={p} /> : <Loader2 size={40} className="spin" />}
    <a className="cx-btn outline" href="/customer/orders">الذهاب إلى طلباتي</a></div>;
}
