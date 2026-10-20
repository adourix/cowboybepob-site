import React, { useEffect, useState } from 'react';
import { Check, Copy, Eye, MessageSquareText, Plus, RefreshCw, Smartphone, X } from 'lucide-react';
import { api, date, money } from '../lib/api';

const FILTERS: [string, string][] = [['all', 'الكل'], ['auto_verified', 'تحقق تلقائي'], ['pending', 'قيد الانتظار'], ['paid', 'مدفوع'], ['rejected', 'مرفوض/فشل'], ['expired', 'منتهي'], ['vodafone_cash', 'فودافون كاش'], ['kashier', 'Kashier'], ['card', 'بطاقة'], ['apple_pay', 'Apple Pay']];
const ST: Record<string, [string, string]> = {
  AWAITING_TRANSFER: ['بانتظار التحويل', 'warn'], PENDING_VERIFICATION: ['بانتظار رسالة SMS', 'warn'], AUTO_VERIFIED: ['تحقق تلقائي — يحتاج مراجعة', 'warn'], PAID: ['مدفوع', 'ok'],
  REJECTED: ['مرفوض', 'bad'], EXPIRED: ['منتهي', 'idle'], REVIEW_EXPIRED: ['انتهت مهلة المراجعة', 'bad'], CREATED: ['جديد', 'idle'], CHECKOUT_STARTED: ['في صفحة الدفع', 'warn'], PROCESSING: ['قيد المعالجة', 'warn'], FAILED: ['فشل', 'bad'], CANCELLED: ['ملغى', 'idle'],
};
const METHOD: Record<string, string> = { VODAFONE_CASH: 'فودافون كاش', CARD: 'بطاقة', APPLE_PAY: 'Apple Pay' };
function S({ v }: { v: string }) { const [t, tone] = ST[v] || [v, 'idle']; return <span className={`status ${tone}`}><i aria-hidden />{t}</span>; }
const left = (iso?: string) => { if (!iso) return ''; const m = Math.round((new Date(iso).getTime() - Date.now()) / 60000); return m <= 0 ? 'انتهت' : m < 60 ? `${m} د` : `${Math.floor(m / 60)} س ${m % 60} د`; };

export function PaymentsAdmin() {
  const [tab, setTab] = useState<'payments' | 'sms' | 'devices'>('payments');
  return <div className="page">
    <header className="scene"><img className="scene-img" src="/bebop/vial.webp" alt="" style={{ objectPosition: '50% 50%' }} /><div className="scene-bars" aria-hidden><span /><span /><span /></div>
      <div className="scene-text"><h1>المدفوعات</h1><p>فودافون كاش بالتحقق من الرسائل ومراجعة المحاسب، وKashier بالتحقق التلقائي.</p></div></header>
    <div className="seg-tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'payments'} className={tab === 'payments' ? 'on' : ''} onClick={() => setTab('payments')}>الدفعات</button>
      <button role="tab" aria-selected={tab === 'sms'} className={tab === 'sms' ? 'on' : ''} onClick={() => setTab('sms')}><MessageSquareText size={15} /> رسائل غير مطابقة</button>
      <button role="tab" aria-selected={tab === 'devices'} className={tab === 'devices' ? 'on' : ''} onClick={() => setTab('devices')}><Smartphone size={15} /> أجهزة الرسائل</button>
    </div>
    {tab === 'payments' ? <PaymentsTable /> : tab === 'sms' ? <UnmatchedSms /> : <Devices />}
  </div>;
}

function PaymentsTable() {
  const [filter, setFilter] = useState('auto_verified'); const [rows, setRows] = useState<any[]>([]); const [err, setErr] = useState(''); const [loading, setLoading] = useState(false); const [open, setOpen] = useState<string | null>(null);
  const load = () => { setLoading(true); setErr(''); api<any[]>(`/api/v1/admin/payments?filter=${filter}`).then(setRows).catch(e => setErr(e.message)).finally(() => setLoading(false)); };
  useEffect(load, [filter]);
  return <section className="panel table-panel">
    <div className="toolbar filter-chips">{FILTERS.map(([k, t]) => <button key={k} className={`chip-btn ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{t}</button>)}<span className="count">{rows.length} دفعة</span><button className="btn btn-ghost" onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> تحديث</button></div>
    {err && <div className="alert error">{err}</div>}
    <div className="table-wrap"><table>
      <thead><tr><th></th><th>الطلب</th><th>العميل</th><th>المبلغ</th><th>الحالة</th><th>المهلة</th><th>الطريقة</th><th>من / مرجع</th><th>إلى</th><th>رسالة SMS</th></tr></thead>
      <tbody>{rows.map(p => <tr key={p.id}>
        <td><button className="btn btn-ghost btn-sm review-btn" onClick={() => setOpen(p.id)}><Eye size={14} /> فتح</button></td>
        <td><span className="code-tag">{p.order_code}</span></td><td>{p.customer_name}</td><td className="num">{money(p.amount_minor)}</td>
        <td><S v={p.status} />{p.provisional_activation && p.status === 'AUTO_VERIFIED' && <small className="muted d-block">الخدمة مفعّلة مؤقتًا</small>}</td>
        <td className="muted">{p.status === 'AUTO_VERIFIED' ? left(p.review_expires_at) : ['AWAITING_TRANSFER', 'PENDING_VERIFICATION', 'CHECKOUT_STARTED'].includes(p.status) ? left(p.expires_at) : ''}</td>
        <td>{METHOD[p.method] || p.method}{p.provider === 'KASHIER' && <small className="muted"> · Kashier</small>}</td>
        <td dir="ltr" className="mono-ish">{p.provider === 'KASHIER' ? (p.provider_reference || '—') : (p.customer_wallet || '—')}</td>
        <td dir="ltr" className="mono-ish">{p.provider === 'KASHIER' ? (p.webhook_status || p.provider_status || '—') : (p.receiving_wallet || '—')}</td>
        <td>{p.sms ? <span dir="ltr" className="mono-ish">{p.sms.reference} · {new Date(p.sms.time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span> : p.provider === 'KASHIER' ? <span className="muted">—</span> : <span className="muted">لم تصل</span>}</td>
      </tr>)}{!rows.length && <tr><td colSpan={10} className="table-empty"><p className="muted" style={{ padding: 30, textAlign: 'center' }}>لا توجد دفعات في هذا التصنيف.</p></td></tr>}</tbody>
    </table></div>
    {open && <PaymentDetail id={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); load(); }} />}
  </section>;
}

function PaymentDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [p, setP] = useState<any>(null); const [reason, setReason] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { void api(`/api/v1/admin/payments/${id}`).then(setP).catch(e => setErr(e.message)); }, [id]);
  const act = async (kind: 'confirm' | 'reject') => {
    if (kind === 'reject' && reason.trim().length < 3) { setErr('اكتب سبب الرفض.'); return; }
    setBusy(true); setErr('');
    try { await api(`/api/v1/admin/payments/${id}/${kind}`, { method: 'POST', body: JSON.stringify({ reason }) }); onChanged(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const canAct = p && p.provider !== 'KASHIER' && ['AUTO_VERIFIED', 'PENDING_VERIFICATION', 'REVIEW_EXPIRED', 'INITIATED'].includes(p.status);
  const checks = p?.match_details?.checks;
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><div className="modal wide-modal" role="dialog" aria-modal="true">
    <div className="modal-head"><h2>مراجعة الدفعة {p?.order_code}</h2><button className="icon-btn" onClick={onClose} aria-label="إغلاق"><X size={18} /></button></div>
    {!p ? <p className="muted">{err || 'جارٍ التحميل…'}</p> : <div className="pay-detail">
      <div className="pd-grid">
        <dl className="pd-kv">
          <div><dt>الحالة</dt><dd><S v={p.status} /></dd></div><div><dt>المبلغ</dt><dd>{money(p.amount_minor)} (الطلب {money(p.total_minor)})</dd></div>
          <div><dt>الطريقة</dt><dd>{METHOD[p.method] || p.method} · {p.provider}</dd></div><div><dt>العميل</dt><dd>{p.customer_name} <span dir="ltr" className="muted">{p.customer_mobile}</span></dd></div>
          {p.provider !== 'KASHIER' ? <>
            <div><dt>محفظة العميل</dt><dd dir="ltr">{p.customer_wallet || '—'}</dd></div><div><dt>محفظتنا</dt><dd dir="ltr">{p.receiving_wallet || '—'}</dd></div>
            <div><dt>تحقق تلقائي</dt><dd>{date(p.auto_verified_at)}</dd></div><div><dt>نهاية المراجعة</dt><dd>{date(p.review_expires_at)}</dd></div>
            <div><dt>تفعيل مؤقت</dt><dd>{p.provisional_activation ? 'نعم — الخدمة تعمل لحين قرارك' : 'لا'}</dd></div>
          </> : <>
            <div><dt>مرجع Kashier</dt><dd dir="ltr">{p.provider_reference || '—'}</dd></div><div><dt>حالة المزوّد</dt><dd>{p.provider_status || '—'}</dd></div>
            <div><dt>Webhook</dt><dd>{p.webhook_status || 'لم يصل'} {p.webhook_received_at && <span className="muted">· {date(p.webhook_received_at)}</span>}</dd></div><div><dt>تم التحقق</dt><dd>{date(p.verified_at)}</dd></div>
          </>}
        </dl>
        {p.has_screenshot && <a className="pd-shot" href={`/api/v1/admin/payments/${p.id}/screenshot`} target="_blank" rel="noreferrer"><img src={`/api/v1/admin/payments/${p.id}/screenshot`} alt="إيصال العميل" /><small>صورة العميل — دليل مساعد فقط</small></a>}
      </div>
      {checks && <div className="pd-checks">{([['amount', 'المبلغ'], ['sender', 'المحفظة المرسلة'], ['receiver', 'محفظتنا'], ['time', 'وقت التحويل']] as const).map(([k, t]) => <span key={k} className={checks[k] ? 'ok' : 'bad'}>{checks[k] ? <Check size={14} /> : <X size={14} />}{t}</span>)}</div>}
      {p.sms?.map((s: any) => <div key={s.id} className="pd-sms"><div className="pd-sms-head"><b>رسالة SMS</b><span dir="ltr" className="mono-ish">{s.parsed_transaction_reference}</span><span className="muted">{date(s.parsed_transaction_time)}</span></div><pre dir="rtl">{s.raw_message}</pre></div>)}
      {p.events?.length > 0 && <details className="pd-log"><summary>أحداث Kashier ({p.events.length})</summary>{p.events.map((e: any) => <div key={e.event_id}><span dir="ltr" className="mono-ish">{e.event_id}</span> → <b>{e.result}</b> <span className="muted">{date(e.received_at)}</span></div>)}</details>}
      <details className="pd-log" open><summary>سجل التغييرات</summary>{p.audit.map((a: any, i: number) => <div key={i}><span className="muted">{date(a.created_at)}</span> · {a.actor_type} · {a.previous_status || '∅'} → <b>{a.new_status}</b>{a.reason ? ` — ${a.reason}` : ''}</div>)}</details>
      {canAct && <div className="pd-actions">
        <label className="field"><span>{p.status === 'AUTO_VERIFIED' ? 'ملاحظة (اختياري للتأكيد، مطلوب للرفض)' : 'سبب القرار (مطلوب: لم تُطابق رسالة SMS تلقائيًا)'}</span><input value={reason} onChange={e => setReason(e.target.value)} placeholder="مثال: تم التأكد من رصيد المحفظة" /></label>
        {err && <div className="alert error">{err}</div>}
        <div className="row-actions"><button className="btn btn-signal" disabled={busy} onClick={() => act('confirm')}><Check size={16} /> تأكيد الدفع</button><button className="btn btn-danger" disabled={busy} onClick={() => act('reject')}><X size={16} /> رفض</button></div>
      </div>}
      {!canAct && err && <div className="alert error">{err}</div>}
    </div>}
  </div></div>;
}

function UnmatchedSms() {
  const [rows, setRows] = useState<any[]>([]); const [err, setErr] = useState('');
  useEffect(() => { void api<any[]>('/api/v1/admin/payment-sms').then(setRows).catch(e => setErr(e.message)); }, []);
  const reason: Record<string, string> = { AMOUNT_MISMATCH: 'المبلغ لا يطابق', SENDER_MISMATCH: 'المحفظة المرسلة لا تطابق', RECEIVER_MISMATCH: 'محفظة الاستلام لا تطابق', RECEIVER_NOT_OURS: 'ليست محفظتنا', OUTSIDE_PAYMENT_WINDOW: 'خارج مهلة الدفع', NO_OPEN_PAYMENTS: 'لا توجد دفعة مفتوحة لهذا الرقم' };
  return <section className="panel table-panel">{err && <div className="alert error">{err}</div>}
    <div className="table-wrap"><table><thead><tr><th>الوقت</th><th>المبلغ</th><th>من</th><th>إلى</th><th>المرجع</th><th>النتيجة</th><th>الجهاز</th></tr></thead><tbody>
      {rows.map(s => <tr key={s.id}><td className="muted">{date(s.parsed_transaction_time || s.received_at)}</td><td className="num">{s.parsed_amount_minor != null ? money(s.parsed_amount_minor) : '—'}</td><td dir="ltr" className="mono-ish">{s.parsed_sender_wallet || '—'}</td><td dir="ltr" className="mono-ish">{s.parsed_receiver_wallet || '—'}</td><td dir="ltr" className="mono-ish">{s.parsed_transaction_reference || '—'}</td>
        <td>{s.parse_status === 'FAILED' ? <span className="status bad"><i />تعذرت القراءة ({s.parse_error})</span> : s.match_status === 'DUPLICATE' ? <span className="status idle"><i />مكررة</span> : <span className="status warn"><i />{reason[s.match_details?.reason] || 'غير مطابقة'}</span>}</td><td>{s.device_name}</td></tr>)}
      {!rows.length && <tr><td colSpan={7} className="table-empty"><p className="muted" style={{ padding: 30, textAlign: 'center' }}>لا توجد رسائل غير مطابقة.</p></td></tr>}
    </tbody></table></div></section>;
}

function Devices() {
  const [rows, setRows] = useState<any[]>([]); const [name, setName] = useState(''); const [key, setKey] = useState(''); const [token, setToken] = useState<{ token: string; key: string } | null>(null); const [err, setErr] = useState('');
  const load = () => api<any[]>('/api/v1/admin/payment-devices').then(setRows).catch(e => setErr(e.message));
  useEffect(() => { void load(); }, []);
  const add = async (e: React.FormEvent) => { e.preventDefault(); setErr(''); try { const r = await api<any>('/api/v1/admin/payment-devices', { method: 'POST', body: JSON.stringify({ name, deviceKey: key }) }); setToken({ token: r.token, key: r.device.device_key }); setName(''); setKey(''); void load(); } catch (x: any) { setErr(x.message); } };
  const toggle = async (d: any) => { try { await api(`/api/v1/admin/payment-devices/${d.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !d.enabled }) }); void load(); } catch (x: any) { setErr(x.message); } };
  const online = (d: any) => d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 10 * 60000;
  return <section className="panel">
    <div className="panel-head"><div><h2>أجهزة استقبال الرسائل</h2><p>هاتف أندرويد عليه محفظة الاستلام، يرسل رسائل فودافون كاش للنظام.</p></div></div>
    {token && <div className="alert token-once"><div><b>توكن الجهاز ({token.key}) — يظهر مرة واحدة فقط:</b><code dir="ltr">{token.token}</code></div><button className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard.writeText(token.token)}><Copy size={14} /> نسخ</button></div>}
    <form className="device-form" onSubmit={add}><label className="field"><span>اسم الجهاز</span><input value={name} onChange={e => setName(e.target.value)} placeholder="هاتف المحفظة الأساسي" required /></label><label className="field"><span>المعرّف</span><input dir="ltr" value={key} onChange={e => setKey(e.target.value)} placeholder="android-wallet-01" required /></label><button className="btn btn-signal"><Plus size={16} /> إضافة جهاز</button></form>
    {err && <div className="alert error">{err}</div>}
    <div className="table-wrap"><table><thead><tr><th>الجهاز</th><th>المعرّف</th><th>الاتصال</th><th>آخر رسالة</th><th></th></tr></thead><tbody>
      {rows.map(d => <tr key={d.id}><td><b>{d.name}</b></td><td dir="ltr" className="mono-ish">{d.device_key}</td><td>{!d.enabled ? <span className="status idle"><i />معطّل</span> : online(d) ? <span className="status ok"><i />متصل</span> : <span className="status bad"><i />{d.last_seen_at ? `آخر ظهور ${date(d.last_seen_at)}` : 'لم يتصل بعد'}</span>}</td><td className="muted">{date(d.last_sms_at)}</td><td><button className={`btn btn-sm ${d.enabled ? 'btn-danger' : 'btn-ghost'}`} onClick={() => toggle(d)}>{d.enabled ? 'تعطيل' : 'تفعيل'}</button></td></tr>)}
      {!rows.length && <tr><td colSpan={5} className="table-empty"><p className="muted" style={{ padding: 24, textAlign: 'center' }}>لم تُسجّل أجهزة بعد.</p></td></tr>}
    </tbody></table></div>
  </section>;
}
