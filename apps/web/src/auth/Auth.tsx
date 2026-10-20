import React, { FormEvent, useEffect, useState } from 'react';
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Lock, LogIn, Mail, Phone, ShieldCheck, User as UserIcon, UserPlus } from 'lucide-react';
import { api, User } from '../lib/api';

type Theme = 'default' | 'red' | 'blue';
const POSTER: Record<Theme, { art: string; title: string; sub: string; quote: string }> = {
  default: { art: '/bebop/spike-panel.webp', title: 'إنترنت بلا حدود', sub: 'خدمات موثوقة .. أينما كنت', quote: '' },
  red: { art: '/bebop/email-verify.webp', title: 'أهلًا بك على المتن', sub: 'خطوة واحدة وتنطلق', quote: 'SEE YOU SPACE COWBOY …' },
  blue: { art: '/bebop/email-reset.webp', title: 'نعيدك إلى المسار', sub: 'كلمة مرور جديدة في دقيقة', quote: 'WHATEVER HAPPENS, HAPPENS …' },
};
function Stage({ children, theme = 'default' }: { children: React.ReactNode; theme?: Theme }) {
  const t = POSTER[theme];
  return <div className={`cx-auth theme-${theme}`}>
    <img className="cx-auth-bg" src="/bebop/login-bg.webp" alt="" />
    <div className="cx-auth-stage">
      <aside className="cx-auth-poster" aria-hidden>
        <div className="poster-frame">
          <img className="poster-logo" src="/bebop/logo.png" alt="" width={140} height={140} />
          <b>CowboyBepob</b>
          <small className="en">INTERNET BEYOND BORDERS</small>
          <i className="rule" />
          <h2>{t.title}</h2>
          <p>{t.sub}</p>
          <img className={`poster-art ${theme !== 'default' ? 'wide' : ''}`} src={t.art} alt="" />
          {t.quote && <span className="poster-quote en">{t.quote}</span>}
        </div>
      </aside>
      <div className="cx-auth-card hud hud-cyan"><div className="hud-in">{children}</div></div>
    </div>
  </div>;
}

function Pwd({ value, onChange, placeholder, autoComplete, id }: { value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string; id?: string }) {
  const [show, setShow] = useState(false);
  return <div className="auth-input"><Lock size={20} /><input id={id} type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoComplete={autoComplete} required minLength={8} /><button type="button" className="eye" onClick={() => setShow(s => !s)} aria-label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}>{show ? <EyeOff size={20} /> : <Eye size={20} />}</button></div>;
}

export function LoginScreen({ onLogin }: { onLogin: (u: User) => void }) {
  const [kind, setKind] = useState<'customer' | 'staff'>('customer');
  const [id, setId] = useState(''); const [password, setPassword] = useState(''); const [otp, setOtp] = useState(''); const [remember, setRemember] = useState(true);
  const [error, setError] = useState(''); const [info, setInfo] = useState(''); const [busy, setBusy] = useState(false); const [forgot, setForgot] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(''); setInfo(''); setBusy(true);
    try { const x = await api<any>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: id.trim(), password, otp, kind, remember }) }); onLogin(x.user); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const sendReset = async (e: FormEvent) => {
    e.preventDefault(); setError(''); setInfo('');
    if (!id.includes('@')) { setError('اكتب بريدك الإلكتروني لإرسال رابط إعادة التعيين.'); return; }
    try { const r = await api<any>('/api/v1/customer/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: id.trim() }) }); setInfo(r.message); } catch (e: any) { setError(e.message); }
  };
  return <Stage theme={forgot ? 'blue' : 'default'}>
    <h1 className="auth-title">{forgot ? 'استعادة كلمة المرور' : 'مرحبًا بعودتك'}</h1>
    <p className="auth-sub">{forgot ? 'سنرسل رابط إعادة التعيين إلى بريدك.' : 'سجّل الدخول إلى حسابك للاستمتاع بخدماتنا'}</p>
    {!forgot && <div className="role-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={kind === 'staff'} className={kind === 'staff' ? 'on' : ''} onClick={() => setKind('staff')}><ShieldCheck size={22} /><span>مدير النظام<small className="en">(Admin)</small></span></button>
      <button type="button" role="tab" aria-selected={kind === 'customer'} className={kind === 'customer' ? 'on' : ''} onClick={() => setKind('customer')}><UserIcon size={22} /><span>عميل</span></button>
    </div>}
    <form className="auth-form" onSubmit={forgot ? sendReset : submit}>
      <div className="auth-input"><UserIcon size={20} /><input value={id} onChange={e => setId(e.target.value)} placeholder={forgot || kind === 'staff' ? 'البريد الإلكتروني' : 'رقم الهاتف أو البريد الإلكتروني'} aria-label="معرّف الدخول" autoComplete="username" required dir="auto" /></div>
      {!forgot && <Pwd value={password} onChange={setPassword} placeholder="كلمة المرور" autoComplete="current-password" />}
      {!forgot && kind === 'staff' && <div className="auth-input"><ShieldCheck size={20} /><input value={otp} onChange={e => setOtp(e.target.value)} placeholder="رمز Authenticator" aria-label="رمز Authenticator" inputMode="numeric" autoComplete="one-time-code" required dir="ltr" /></div>}
      {!forgot && <div className="auth-row">
        <label className="chk"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /><span>تذكرني</span></label>
        {kind === 'customer' && <button type="button" className="auth-link" onClick={() => { setForgot(true); setError(''); }}>نسيت كلمة المرور؟</button>}
      </div>}
      {error && <div className="cx-alert bad" role="alert">{error}</div>}
      {info && <div className="cx-alert ok" role="status">{info}</div>}
      <button className="cx-btn gold big block" disabled={busy}>{forgot ? <><Mail size={20} />إرسال الرابط</> : <><LogIn size={20} />{busy ? 'جارٍ التحقق…' : 'تسجيل الدخول'}</>}</button>
    </form>
    {forgot ? <p className="auth-foot"><button className="auth-link" onClick={() => { setForgot(false); setInfo(''); setError(''); }}>العودة لتسجيل الدخول</button></p>
      : kind === 'customer' && <p className="auth-foot">ليس لديك حساب؟ <NavLink to="/register" className="auth-link gold">إنشاء حساب جديد</NavLink></p>}
  </Stage>;
}

export function RegisterScreen() {
  const [v, setV] = useState({ firstName: '', lastName: '', email: '', password: '', confirm: '', mobilePhone: '', landline: '' });
  const [agree, setAgree] = useState(false); const [error, setError] = useState(''); const [done, setDone] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (v.password !== v.confirm) { setError('تأكيد كلمة المرور لا يطابق.'); return; }
    if (!agree) { setError('يجب الموافقة على الشروط وسياسة الخصوصية.'); return; }
    setBusy(true);
    try { const r = await api<any>('/api/v1/customer/auth/register', { method: 'POST', body: JSON.stringify({ firstName: v.firstName, lastName: v.lastName, email: v.email.trim(), password: v.password, mobilePhone: v.mobilePhone, landline: v.landline || undefined }) }); setDone(r.email); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  if (done) return <Stage theme="red"><h1 className="auth-title">تحقق من <span className="accent">بريدك</span></h1><p className="auth-sub">أرسلنا رابط التفعيل إلى <b dir="ltr">{done}</b>. افتح الرابط لتفعيل حسابك ثم سجّل الدخول.</p><NavLink to="/login" className="cx-btn gold big block">العودة لتسجيل الدخول</NavLink></Stage>;
  return <Stage>
    <h1 className="auth-title">إنشاء حساب جديد</h1>
    <p className="auth-sub">انضم إلينا واستمتع بخدماتنا الموثوقة أينما كنت</p>
    <form className="auth-form" onSubmit={submit}>
      <div className="two">
        <div className="auth-input labeled"><UserIcon size={20} /><label><span>الاسم الأول</span><input value={v.firstName} onChange={set('firstName')} autoComplete="given-name" required /></label></div>
        <div className="auth-input labeled"><UserIcon size={20} /><label><span>الاسم الأخير</span><input value={v.lastName} onChange={set('lastName')} autoComplete="family-name" required /></label></div>
      </div>
      <div className="auth-input labeled"><Mail size={20} /><label><span>البريد الإلكتروني</span><input type="email" dir="ltr" value={v.email} onChange={set('email')} placeholder="example@email.com" autoComplete="email" required /></label></div>
      <Pwd value={v.password} onChange={x => setV({ ...v, password: x })} placeholder="كلمة المرور (8 أحرف على الأقل)" autoComplete="new-password" />
      <Pwd value={v.confirm} onChange={x => setV({ ...v, confirm: x })} placeholder="تأكيد كلمة المرور" autoComplete="new-password" />
      <div className="auth-input labeled"><Phone size={20} /><span className="cc en">+20</span><label><span>رقم الموبايل</span><input dir="ltr" inputMode="tel" value={v.mobilePhone} onChange={set('mobilePhone')} placeholder="01012345678" autoComplete="tel-national" required /></label></div>
      <div className="auth-input labeled"><Phone size={20} /><span className="cc en">+20</span><label><span>الرقم الأرضي (اختياري)</span><input dir="ltr" inputMode="tel" value={v.landline} onChange={set('landline')} placeholder="0223456789" /></label></div>
      <label className="chk agree"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} /><span>أوافق على الشروط والأحكام وسياسة الخصوصية</span></label>
      {error && <div className="cx-alert bad" role="alert">{error}</div>}
      <button className="cx-btn gold big block" disabled={busy}><UserPlus size={20} />{busy ? 'جارٍ إنشاء الحساب…' : 'إنشاء الحساب'}</button>
    </form>
    <p className="auth-foot">لديك حساب بالفعل؟ <NavLink to="/login" className="auth-link gold">تسجيل الدخول</NavLink></p>
  </Stage>;
}

export function VerifyEmailScreen() {
  const [params] = useSearchParams(); const [state, setState] = useState<'busy' | 'ok' | 'bad'>('busy'); const [msg, setMsg] = useState('');
  useEffect(() => { const t = params.get('token'); if (!t) { setState('bad'); setMsg('الرابط غير مكتمل.'); return; } void api<any>(`/api/v1/customer/auth/verify-email?token=${encodeURIComponent(t)}`).then(r => { setState('ok'); setMsg(r.message); }).catch(e => { setState('bad'); setMsg(e.message === 'Invalid or expired token' ? 'الرابط غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا.' : e.message); }); }, []);
  return <Stage theme="red"><h1 className="auth-title">تأكيد <span className="accent">البريد الإلكتروني</span></h1><p className="auth-sub">{state === 'busy' ? 'جارٍ التحقق من الرابط…' : msg}</p>{state !== 'busy' && <NavLink to="/login" className="cx-btn gold big block">تسجيل الدخول</NavLink>}</Stage>;
}

export function ResetPasswordScreen() {
  const [params] = useSearchParams(); const nav = useNavigate(); const [p, setP] = useState(''); const [c, setC] = useState(''); const [err, setErr] = useState(''); const [ok, setOk] = useState(false);
  const submit = async (e: FormEvent) => { e.preventDefault(); setErr(''); if (p !== c) { setErr('تأكيد كلمة المرور لا يطابق.'); return; } try { await api('/api/v1/customer/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: params.get('token'), password: p }) }); setOk(true); window.setTimeout(() => nav('/login'), 1800); } catch (x: any) { setErr(x.message === 'Invalid or expired token' ? 'الرابط غير صالح أو انتهت صلاحيته.' : x.message); } };
  return <Stage theme="blue"><h1 className="auth-title">إعادة تعيين <span className="accent">كلمة المرور</span></h1>
    {ok ? <p className="auth-sub">تم تغيير كلمة المرور. جارٍ تحويلك لتسجيل الدخول…</p> : <form className="auth-form" onSubmit={submit}>
      <Pwd value={p} onChange={setP} placeholder="كلمة المرور الجديدة" autoComplete="new-password" />
      <Pwd value={c} onChange={setC} placeholder="تأكيد كلمة المرور" autoComplete="new-password" />
      {err && <div className="cx-alert bad">{err}</div>}
      <button className="cx-btn gold big block">حفظ كلمة المرور</button>
    </form>}
  </Stage>;
}
