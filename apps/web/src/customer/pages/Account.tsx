import React, { FormEvent, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { CalendarDays, Info, KeyRound, Mail, MapPin, Pencil, Phone, Plus, Router as RouterIcon, Star, Trash2, User as UserIcon } from 'lucide-react';
import { api, dateOnly, gb, label, money, num, shortName } from '../../lib/api';
import { AccountLayout, localMobile, usePortal } from '../Portal';
import { compareCreatedAtThenId, customerStatus, usagePercent } from '../selection';
import { Banner, Bar, Empty, Hud, Modal, Pill, useToast } from '../ui';
import { statusTone } from '../serviceActions';
import { PAY_STATUS } from '../PaymentFlow';

function Shell({ title, sub, action, children }: { title: string; sub: string; action?: React.ReactNode; children: React.ReactNode }) {
  const { user } = usePortal();
  return <>
    <Banner art="bridge" eyebrow="WELCOME BACK" title={shortName(user.fullName)} sub="إدارة حسابك وخدماتك في مكان واحد." />
    <AccountLayout><Hud className="page-title"><div><h1>{title}</h1><p>{sub}</p></div>{action}</Hud>{children}</AccountLayout>
  </>;
}
function useSubmit(fn: () => Promise<void>) {
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e?: FormEvent) => { e?.preventDefault(); setErr(''); setBusy(true); try { await fn(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } };
  return { err, busy, submit };
}

export function ProfilePage() {
  const { profile, landlines, refresh } = usePortal(); const toast = useToast(); const [edit, setEdit] = useState(false);
  return <Shell title="الملف الشخصي" sub="عرض وتعديل بيانات حسابك الأساسية." action={<button className="cx-btn gold" onClick={() => setEdit(true)}><Pencil size={17} />تعديل البيانات</button>}>
    {toast.node}
    <Hud className="profile-card">
      <div className="pc-id"><img src="/bebop/logo.png" alt="" width={110} height={110} /><div><h2>{profile?.full_name}</h2><span>عميل</span><span dir="ltr">{profile?.email}</span>{profile?.created_at && <small>عضو منذ {dateOnly(profile.created_at)}</small>}</div></div>
      <dl className="pc-fields">
        <div><UserIcon size={20} /><dt>الاسم الكامل</dt><dd>{profile?.full_name}</dd></div>
        <div><Mail size={20} /><dt>البريد الإلكتروني</dt><dd dir="ltr">{profile?.email}</dd></div>
        <div><Phone size={20} /><dt>الموبايل الأساسي</dt><dd dir="ltr">{localMobile(profile?.mobile_phone)}</dd></div>
        <div><CalendarDays size={20} /><dt>رمز العميل</dt><dd dir="ltr">{profile?.public_code}</dd></div>
      </dl>
    </Hud>
    <PhonesBlock />
    {edit && profile && <EditProfile onClose={() => setEdit(false)} onSaved={async () => { setEdit(false); await refresh(); toast.ok('تم حفظ البيانات'); }} />}
  </Shell>;
}

function EditProfile({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { profile } = usePortal(); const [v, setV] = useState({ fullName: profile?.full_name || '', mobilePhone: localMobile(profile?.mobile_phone) });
  const { err, busy, submit } = useSubmit(async () => { await api('/api/v1/customer/profile', { method: 'PATCH', body: JSON.stringify(v) }); onSaved(); });
  return <Modal title="تعديل البيانات" onClose={onClose}><form className="cx-form" onSubmit={submit}>
    <label className="cx-field"><span>الاسم الكامل</span><input value={v.fullName} onChange={e => setV({ ...v, fullName: e.target.value })} required /></label>
    <label className="cx-field"><span>رقم الموبايل الأساسي</span><input dir="ltr" inputMode="tel" value={v.mobilePhone} onChange={e => setV({ ...v, mobilePhone: e.target.value })} required /></label>
    <p className="cx-muted small">البريد الإلكتروني مرتبط بتسجيل الدخول ولا يمكن تغييره من هنا.</p>
    {err && <div className="cx-alert bad">{err}</div>}
    <button className="cx-btn gold block" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}</button>
  </form></Modal>;
}

function PhonesBlock() {
  const { profile, landlines, refresh } = usePortal(); const toast = useToast(); const [adding, setAdding] = useState(false); const [n, setN] = useState(''); const [lb, setLb] = useState('');
  const add = useSubmit(async () => { await api('/api/v1/customer/landlines', { method: 'POST', body: JSON.stringify({ number: n, label: lb }) }); setN(''); setLb(''); setAdding(false); await refresh(); toast.ok('تمت إضافة الرقم'); });
  const del = async (id: string, num: string) => { if (!confirm(`حذف الرقم ${num}؟`)) return; try { await api('/api/v1/customer/landlines/' + id, { method: 'DELETE' }); await refresh(); toast.ok('تم حذف الرقم'); } catch (e: any) { toast.bad(e.message); } };
  return <Hud className="phones">
    {toast.node}
    <div className="hud-head"><div><h2>أرقام الهاتف</h2><p>الموبايل الأساسي للإشعارات، والأرقام الأرضية لربط الخدمات بها.</p></div><button className="cx-btn gold" onClick={() => setAdding(true)}><Plus size={17} />إضافة رقم أرضي</button></div>
    <div className="phone-row primary"><span className="ph-ico"><Phone size={20} /></span><div><b dir="ltr">{localMobile(profile?.mobile_phone)}</b> <span className="star-tag"><Star size={13} />الرقم الأساسي</span><small>يستخدم للإشعارات والتواصل بشأن الطلبات والشحن.</small></div><Pill tone="ok">مفعّل</Pill></div>
    {landlines.map(l => <div className="phone-row" key={l.id}><span className="ph-ico"><Phone size={20} /></span><div><b dir="ltr">{l.number}</b><small>{l.label || 'رقم أرضي'}</small></div><button className="cx-btn small outline-red" onClick={() => del(l.id, l.number)}><Trash2 size={15} />حذف</button></div>)}
    {adding && <form className="phone-add" onSubmit={add.submit}><input dir="ltr" inputMode="tel" placeholder="0225551111" value={n} onChange={e => setN(e.target.value)} required aria-label="الرقم الأرضي" /><input placeholder="اسم اختياري (البيت، الشغل)" value={lb} onChange={e => setLb(e.target.value)} aria-label="اسم الرقم" /><button className="cx-btn gold" disabled={add.busy}>حفظ</button><button type="button" className="cx-btn outline" onClick={() => setAdding(false)}>إلغاء</button></form>}
    {add.err && <div className="cx-alert bad">{add.err}</div>}
    <div className="info-note"><Info size={22} /><p>يمكنك إضافة أكثر من رقم أرضي، وكل كونفيج جديد يُربط بأحدها. لا يمكن حذف رقم مرتبط بخدمة أو طلب جارٍ.</p></div>
  </Hud>;
}
export function PhonesPage() { return <Shell title="أرقام الهاتف" sub="إدارة أرقام الهاتف المرتبطة بحسابك."><PhonesBlock /></Shell>; }

export function SettingsPage() {
  const toast = useToast(); const [v, setV] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const { err, busy, submit } = useSubmit(async () => { if (v.newPassword !== v.confirm) throw new Error('تأكيد كلمة المرور لا يطابق.'); await api('/api/v1/customer/password', { method: 'POST', body: JSON.stringify({ currentPassword: v.currentPassword, newPassword: v.newPassword }) }); setV({ currentPassword: '', newPassword: '', confirm: '' }); toast.ok('تم تغيير كلمة المرور، وتم تسجيل الخروج من الأجهزة الأخرى.'); });
  return <Shell title="الإعدادات" sub="الأمان وكلمة المرور.">
    {toast.node}
    <Hud><form className="cx-form narrow" onSubmit={submit}>
      <h2 className="sub-h"><KeyRound size={20} />تغيير كلمة المرور</h2>
      <label className="cx-field"><span>كلمة المرور الحالية</span><input type="password" autoComplete="current-password" value={v.currentPassword} onChange={e => setV({ ...v, currentPassword: e.target.value })} required /></label>
      <label className="cx-field"><span>كلمة المرور الجديدة</span><input type="password" autoComplete="new-password" minLength={8} value={v.newPassword} onChange={e => setV({ ...v, newPassword: e.target.value })} required /></label>
      <label className="cx-field"><span>تأكيد كلمة المرور الجديدة</span><input type="password" autoComplete="new-password" minLength={8} value={v.confirm} onChange={e => setV({ ...v, confirm: e.target.value })} required /></label>
      {err && <div className="cx-alert bad">{err}</div>}
      <button className="cx-btn gold" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'تغيير كلمة المرور'}</button>
    </form></Hud>
  </Shell>;
}

export function AddressPage() {
  const { profile, refresh } = usePortal(); const toast = useToast();
  const [v, setV] = useState({ addressLine: profile?.address_line || '', city: profile?.city || '', governorate: profile?.governorate || '' });
  const { err, busy, submit } = useSubmit(async () => { await api('/api/v1/customer/profile', { method: 'PATCH', body: JSON.stringify(v) }); await refresh(); toast.ok('تم حفظ عنوان الشحن'); });
  return <Shell title="عنوان الشحن" sub="العنوان الذي نشحن إليه الراوترات.">
    {toast.node}
    <Hud><form className="cx-form narrow" onSubmit={submit}>
      <label className="cx-field"><span>العنوان بالتفصيل</span><input value={v.addressLine} onChange={e => setV({ ...v, addressLine: e.target.value })} placeholder="الشارع، رقم المبنى، الشقة" required /></label>
      <div className="two"><label className="cx-field"><span>المدينة</span><input value={v.city} onChange={e => setV({ ...v, city: e.target.value })} required /></label><label className="cx-field"><span>المحافظة</span><input value={v.governorate} onChange={e => setV({ ...v, governorate: e.target.value })} /></label></div>
      {err && <div className="cx-alert bad">{err}</div>}
      <button className="cx-btn gold" disabled={busy}><MapPin size={17} />{busy ? 'جارٍ الحفظ…' : 'حفظ العنوان'}</button>
    </form></Hud>
  </Shell>;
}

export function DevicesPage() {
  const { routers, refresh } = usePortal(); const toast = useToast(); const [req, setReq] = useState<any>(null); const [reason, setReason] = useState('');
  const send = useSubmit(async () => { await api(`/api/v1/customer/routers/${req.id}/replacement-requests`, { method: 'POST', body: JSON.stringify({ reason }) }); setReq(null); setReason(''); await refresh(); toast.ok('تم إرسال طلب الاستبدال. سيراجعه فريقنا.'); });
  return <Shell title="أجهزتي" sub="الراوترات المسجلة باسمك وحالتها.">
    {toast.node}
    {routers.length ? <div className="device-list">{routers.map(r => <Hud key={r.id} className="device">
      <img src="/bebop/router-kt.webp" alt="" />
      <div><b className="en">{r.model}</b><span dir="ltr">{r.public_code}</span><small>الخدمة: <span dir="ltr">{r.assigned_service || 'غير مرتبط'}</span>{r.firmware_version ? <> · الإصدار <span dir="ltr">{r.firmware_version}</span></> : null}</small></div>
      <div className="device-status"><Pill tone={r.connectivity === 'ONLINE' ? 'ok' : r.connectivity === 'OFFLINE' ? 'bad' : 'idle'}>{label(r.connectivity)}</Pill><small>{label(r.lifecycle_status)}</small></div>
      {r.replacement_status ? <span className="cx-muted small">طلب استبدال قيد المراجعة</span> : <button className="cx-btn small outline" onClick={() => setReq(r)}>طلب استبدال</button>}
    </Hud>)}</div> : <Hud><Empty title="لا توجد أجهزة مسجلة" text="الراوترات التي تشتريها تظهر هنا بعد تجهيزها." action={<NavLink to="/customer/routers" className="cx-btn gold">تصفح الراوترات</NavLink>} /></Hud>}
    {req && <Modal title={`طلب استبدال ${req.public_code}`} onClose={() => setReq(null)}><form className="cx-form" onSubmit={send.submit}>
      <label className="cx-field"><span>سبب الاستبدال</span><textarea value={reason} onChange={e => setReason(e.target.value)} rows={4} required placeholder="مثال: الجهاز لا يعمل بعد انقطاع الكهرباء" /></label>
      <p className="cx-muted small">هذا طلب وليس إجراءً فوريًا. سيراجعه الفريق ويتواصل معك، ويتم تغيير بيانات الاتصال للأمان.</p>
      {send.err && <div className="cx-alert bad">{send.err}</div>}
      <button className="cx-btn gold block" disabled={send.busy}>إرسال الطلب</button>
    </form></Modal>}
  </Shell>;
}

export function PaymentsPage() {
  const toast = useToast(); const [rows, setRows] = useState<any[] | null>(null);
  React.useEffect(() => { void api<any[]>('/api/v1/customer/payments').then(setRows).catch(e => { toast.bad(e.message); setRows([]); }); }, []);
  const st: Record<string, [string, 'ok' | 'warn' | 'bad' | 'idle']> = Object.fromEntries(Object.entries(PAY_STATUS).map(([k, [t, tone]]) => [k, [t, tone === 'info' ? 'warn' : tone]])) as any;
  return <Shell title="المدفوعات" sub="طريقة الدفع الحالية وسجل مدفوعاتك.">
    {toast.node}
    <Hud className="pay-method"><h2 className="sub-h">طريقة الدفع</h2><p>فودافون كاش (وأورنج كاش إن كان متاحًا) لكل الطلبات: حوّل المبلغ وأرسل رقم محفظتك وصورة الإيصال، ونتحقق تلقائيًا من رسالة التحويل ثم يراجعها المحاسب. البطاقات و Apple Pay متاحة للطلبات من 75 جنيه عبر Kashier، ولا نخزن أي بيانات بطاقات لدينا.</p></Hud>
    <Hud>{rows === null ? <p className="cx-muted">جارٍ التحميل…</p> : rows.length ? <table className="cx-table"><thead><tr><th>الطلب</th><th>المبلغ</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>
      {rows.map(p => <tr key={p.id}><td dir="ltr">{p.order_code}</td><td>{money(p.amount_minor, p.currency)}</td><td><Pill tone={(st[p.status] || ['', 'idle'])[1]}>{(st[p.status] || [p.status])[0]}</Pill></td><td>{dateOnly(p.paid_at || p.created_at)}</td></tr>)}
    </tbody></table> : <Empty title="لا توجد مدفوعات بعد" />}</Hud>
  </Shell>;
}

export function UsagePage() {
  const { services, orders } = usePortal();
  const list = [...services].sort(compareCreatedAtThenId);
  const spent = orders.filter(o => o.paid_at).reduce((a, o) => a + Number(o.total_minor || 0), 0);
  return <Shell title="الاستخدام والفواتير" sub="استهلاك كل خدمة وإجمالي ما دفعته.">
    <div className="stat-row two">
      <Hud className="stat"><div><span>إجمالي المدفوع</span><b>{money(spent)}</b></div></Hud>
      <Hud className="stat"><div><span>طلبات مدفوعة</span><b>{num(orders.filter(o => o.paid_at).length)}</b></div></Hud>
    </div>
    <Hud>{list.length ? <table className="cx-table"><thead><tr><th>الخدمة</th><th>الحالة</th><th>الاستهلاك</th><th>الانتهاء</th></tr></thead><tbody>
      {list.map(s => { const sub = s.subscription, pct = usagePercent(sub?.usedBytes, sub?.quotaBytes); return <tr key={s.id}><td><b>{s.label || s.categoryName}</b><br /><small dir="ltr">{s.code}</small></td><td><Pill tone={statusTone(s)}>{customerStatus(s).text}</Pill></td><td className="use-cell"><span className="en">{gb(sub?.usedBytes) ?? 0}{sub?.quotaBytes ? ` / ${gb(sub.quotaBytes)}` : ''} GB</span>{pct != null && <Bar pct={pct} />}</td><td>{dateOnly(sub?.currentPeriodEnd)}</td></tr>; })}
    </tbody></table> : <Empty title="لا توجد خدمات بعد" />}</Hud>
    <Hud><h2 className="sub-h">الفواتير</h2>{orders.length ? <table className="cx-table"><thead><tr><th>الطلب</th><th>العناصر</th><th>الإجمالي</th><th>الحالة</th></tr></thead><tbody>{orders.map(o => <tr key={o.id}><td dir="ltr">{o.public_code}</td><td>{(o.items || []).map((i: any) => i.name).join('، ')}</td><td>{money(o.total_minor, o.currency)}</td><td>{label(o.status)}</td></tr>)}</tbody></table> : <p className="cx-muted">لا توجد فواتير بعد.</p>}</Hud>
  </Shell>;
}
