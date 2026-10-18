import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useNavigate, useLocation, NavLink, Routes, Route } from 'react-router-dom';
import { Box, Check, Copy, CreditCard, ExternalLink, HardDrive, LayoutDashboard, LogOut, Menu, Network, Package, Plus, RefreshCw, Search, Settings, ShieldCheck, ShoppingCart, Users, Wifi, Workflow, Trash2, X } from 'lucide-react';
import './styles.css';

/* ───────────── API ───────────── */
const API = import.meta.env.VITE_API_URL || '/';
function csrfToken() {
  const raw = document.cookie.split('; ').find(x => x.startsWith('cb_csrf='))?.split('=')[1];
  if (!raw) return '';
  try { return decodeURIComponent(raw); } catch { return raw; }
}
async function api(path: string, init: RequestInit = {}) {
  const h = new Headers(init.headers);
  if (init.body != null) h.set('content-type', 'application/json');
  const csrf = csrfToken();
  if (csrf && init.method && init.method !== 'GET') h.set('x-csrf-token', csrf);
  const r = await fetch(API.replace(/\/$/, '') + path, { ...init, headers: h, credentials: 'include' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

/* ───────────── Formatting ───────────── */
const money = (v: any, c = 'EGP') => `${(Number(v || 0) / 100).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${c}`;
const date = (v: any) => v ? new Date(v).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const labels: Record<string, string> = { ACTIVE: 'نشط', PROVISIONING: 'قيد التجهيز', SUSPENDED: 'موقوف', TERMINATED: 'منتهٍ', READY: 'جاهز', ASSIGNED: 'مُسند', IN_STOCK: 'في المخزن', READY_TO_SHIP: 'جاهز للشحن', SHIPPED: 'تم الشحن', ONLINE: 'متصل', OFFLINE: 'غير متصل', UNKNOWN: 'غير معروف', PAID: 'مدفوع', FULFILLING: 'قيد التنفيذ', COMPLETED: 'مكتمل', PENDING_PAYMENT: 'بانتظار الدفع', NEEDS_ATTENTION: 'يحتاج تدخل', SUCCEEDED: 'ناجح', INITIATED: 'مبدئي', QUEUED: 'في الانتظار', RUNNING: 'قيد التشغيل', FAILED: 'فشل', CANCELLED: 'ملغى' };
const label = (v: any) => labels[String(v)] || v || '—';
const TONE: Record<string, 'ok' | 'warn' | 'bad'> = {
  ACTIVE: 'ok', READY: 'ok', ONLINE: 'ok', PAID: 'ok', SUCCEEDED: 'ok', COMPLETED: 'ok', HEALTHY: 'ok', CURRENT: 'ok', SHIPPED: 'ok',
  PROVISIONING: 'warn', ASSIGNED: 'warn', IN_STOCK: 'warn', READY_TO_SHIP: 'warn', FULFILLING: 'warn', PENDING_PAYMENT: 'warn', INITIATED: 'warn', PENDING: 'warn', QUEUED: 'warn', RUNNING: 'warn', DEGRADED: 'warn', DRAINING: 'warn', MAINTENANCE: 'warn',
  SUSPENDED: 'bad', TERMINATED: 'bad', OFFLINE: 'bad', NEEDS_ATTENTION: 'bad', FAILED: 'bad', CANCELLED: 'bad', DOWN: 'bad', EXPIRED: 'bad', REJECTED: 'bad'
};
function Status({ v }: { v: any }) {
  return <span className={`status ${TONE[String(v)] || 'idle'}`}><i aria-hidden />{label(v)}</span>;
}
type User = { type: 'STAFF' | 'CUSTOMER'; id: string; role?: string; email: string; fullName: string };

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ───────────── Scenes (page banners from the provided stills) ───────────── */
type SceneKey = 'mars' | 'police' | 'blast' | 'idle' | 'router' | 'asteria' | 'files' | 'hull' | 'vial';
const SCENE_IMG: Record<SceneKey, { src: string; pos: string }> = {
  mars: { src: '/bebop/mars.webp', pos: '50% 38%' },
  police: { src: '/bebop/police-index.webp', pos: '50% 45%' },
  blast: { src: '/bebop/gate-blast.webp', pos: '50% 45%' },
  idle: { src: '/bebop/gate-idle.webp', pos: '40% 45%' },
  router: { src: '/bebop/router-708.webp', pos: '30% 45%' },
  asteria: { src: '/bebop/asteria.webp', pos: '50% 40%' },
  files: { src: '/bebop/outernet-files.webp', pos: '50% 30%' },
  hull: { src: '/bebop/bebop-hull.webp', pos: '45% 50%' },
  vial: { src: '/bebop/vial.webp', pos: '50% 50%' },
};
function Scene({ scene, title, sub, onAdd, addText = 'إضافة' }: { scene: SceneKey; title: string; sub?: string; onAdd?: () => void; addText?: string }) {
  const s = SCENE_IMG[scene];
  return <header className="scene">
    <img className="scene-img" src={s.src} alt="" style={{ objectPosition: s.pos }} />
    <div className="scene-bars" aria-hidden><span /><span /><span /></div>
    <div className="scene-text">
      <h1>{title}</h1>
      {sub && <p>{sub}</p>}
    </div>
    {onAdd && <button className="btn btn-signal scene-action" onClick={onAdd}><Plus size={16} />{addText}</button>}
  </header>;
}

/* ───────────── Gate jump (login transition, uses the uploaded clip reversed) ───────────── */
function GateJump({ onDone }: { onDone: () => void }) {
  const [flash, setFlash] = useState(false);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return; done.current = true;
    setFlash(true);
    window.setTimeout(onDone, 420);
  };
  useEffect(() => {
    if (reducedMotion()) { onDone(); return; }
    const t = window.setTimeout(finish, 4200); // safety net if the video stalls
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish(); };
    window.addEventListener('keydown', k);
    return () => { window.clearTimeout(t); window.removeEventListener('keydown', k); };
  }, []);
  return <div className={`gate-jump ${flash ? 'flash' : ''}`} onClick={finish} role="status" aria-live="polite">
    <video autoPlay muted playsInline preload="auto" onEnded={finish} onError={finish}>
      <source src="/bebop/gate-jump.webm" type="video/webm" />
      <source src="/bebop/gate-jump.mp4" type="video/mp4" />
    </video>
    <div className="gate-jump-caption">
      <b>جارٍ فتح البوابة</b>
      <span>اضغط في أي مكان للتخطي</span>
    </div>
  </div>;
}

/* Ring wipe on every route change: answers the click on a nav link. */
function RouteGate() {
  const { pathname } = useLocation();
  const first = useRef(true);
  const [n, setN] = useState(0);
  useEffect(() => { if (first.current) { first.current = false; return; } if (!reducedMotion()) setN(x => x + 1); }, [pathname]);
  return n ? <div key={n} className="route-gate" aria-hidden><span /></div> : null;
}

/* ───────────── Shared bits ───────────── */
function Logo({ size = 44 }: { size?: number }) {
  return <img className="logo" src="/bebop/logo.png" width={size} height={size} alt="CowboyBepob" />;
}
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="إغلاق"><X size={18} /></button></div>
      {children}
    </div>
  </div>;
}
function Field({ label: txt, value, onChange, type = 'text', placeholder }: { label: string; value: any; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return <label className="field"><span>{txt}</span><input value={value} onChange={e => onChange(e.target.value)} type={type} placeholder={placeholder} /></label>;
}
function Empty({ text }: { text: string }) {
  return <div className="empty"><img src="/bebop/vial.webp" alt="" /><p>{text}</p></div>;
}
function Panel({ title, sub, action, children, className = '' }: { title?: string; sub?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>
    {(title || action) && <div className="panel-head"><div>{title && <h2>{title}</h2>}{sub && <p>{sub}</p>}</div>{action}</div>}
    {children}
  </section>;
}

/* ───────────── Login ───────────── */
function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [kind, setKind] = useState<'staff' | 'customer'>('staff');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [otp, setOtp] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    try { const x = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password, otp, kind }) }); onLogin(x.user); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return <div className="auth">
    <div className="auth-visual" aria-hidden>
      <img src="/bebop/mars.webp" alt="" />
      <div className="auth-blocks"><span /><span /><span /><span /></div>
      <div className="auth-mark">
        <Logo size={120} />
        <strong>CowboyBepob</strong>
        <p dir="rtl">بروكسي وراوترات جاهزة، من البوابة إلى بيتك.</p>
      </div>
    </div>
    <div className="auth-side">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-card-top"><Logo size={36} /><b>CowboyBepob</b></div>
        <h1>تسجيل الدخول</h1>
        <div className="segmented" role="tablist">
          <button type="button" role="tab" aria-selected={kind === 'staff'} className={kind === 'staff' ? 'on' : ''} onClick={() => setKind('staff')}>الموظفون</button>
          <button type="button" role="tab" aria-selected={kind === 'customer'} className={kind === 'customer' ? 'on' : ''} onClick={() => setKind('customer')}>العملاء</button>
        </div>
        <label className="field"><span>البريد الإلكتروني</span><input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" required /></label>
        <label className="field"><span>كلمة المرور</span><input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="current-password" required /></label>
        {kind === 'staff' && <label className="field"><span>رمز Authenticator</span><input value={otp} onChange={e => setOtp(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required /></label>}
        {error && <div className="alert error">{error}</div>}
        <button className="btn btn-signal btn-full" type="submit" disabled={busy}>{busy ? 'جارٍ التحقق…' : 'دخول'}</button>
      </form>
    </div>
  </div>;
}

/* ───────────── Admin shell ───────────── */
const NAV_GROUPS = [
  { caption: 'التشغيل', items: [['/admin', 'نظرة عامة', LayoutDashboard], ['/admin/customers', 'العملاء', Users], ['/admin/services', 'الخدمات', Wifi], ['/admin/subscriptions', 'الاشتراكات', CreditCard], ['/admin/routers', 'الراوترات', Network]] },
  { caption: 'البنية', items: [['/admin/servers', 'الخوادم', HardDrive], ['/admin/providers', 'المزوّدون', Settings], ['/admin/configs', 'الكونفيجات', Box], ['/admin/catalog', 'الكتالوج', Package]] },
  { caption: 'المال', items: [['/admin/orders', 'الطلبات', ShoppingCart], ['/admin/payments', 'المدفوعات', CreditCard]] },
  { caption: 'السجلات', items: [['/admin/jobs', 'المهام', Workflow], ['/admin/audit', 'التدقيق', ShieldCheck]] },
] as const;
const PAGE_NAMES: Record<string, string> = { ...Object.fromEntries(NAV_GROUPS.flatMap(g => g.items.map(([to, t]): [string, string] => [to, t]))), '/admin/settings': 'الإعدادات' };

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 30000); return () => window.clearInterval(t); }, []);
  return now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}
function Shell({ user, onLogout, children }: { user: User; onLogout: () => void; children: React.ReactNode }) {
  const location = useLocation(); const [open, setOpen] = useState(false); const clock = useClock();
  useEffect(() => setOpen(false), [location.pathname]);
  return <div className={`shell ${open ? 'nav-open' : ''}`}>
    <aside className="console" aria-label="القائمة">
      <div className="console-brand"><Logo size={46} /><div><b>CowboyBepob</b><span>لوحة الإدارة</span></div></div>
      <div className="ticker" aria-hidden><div>{'OUTERNET '.repeat(16)}</div></div>
      <nav>
        {NAV_GROUPS.map(g => <div className="nav-group" key={g.caption}>
          <div className="nav-caption">{g.caption}</div>
          {g.items.map(([to, t, I]) => <NavLink key={to} to={to} end={to === '/admin'} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}><I size={17} /><span>{t}</span></NavLink>)}
        </div>)}
      </nav>
      <div className="console-bottom">
        <NavLink to="/customer" className="nav-link"><ExternalLink size={16} /><span>بوابة العميل</span></NavLink>
        <NavLink to="/admin/settings" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}><Settings size={16} /><span>الإعدادات</span></NavLink>
        <button className="profile" onClick={onLogout} title="تسجيل الخروج">
          <span className="avatar">{user.fullName.slice(0, 1)}</span>
          <span className="profile-text"><b>{user.fullName}</b><small>{user.email}</small></span>
          <LogOut size={16} />
        </button>
      </div>
    </aside>
    <div className="nav-scrim" onClick={() => setOpen(false)} />
    <main className="main">
      <header className="topbar">
        <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="فتح القائمة"><Menu size={20} /></button>
        <div className="crumb"><span>المنصة</span><b aria-hidden>/</b><strong>{PAGE_NAMES[location.pathname] || 'نظرة عامة'}</strong></div>
        <div className="top-actions">
          <span className="ship-time" title="الوقت المحلي">{clock}</span>
          <span className="avatar">{user.fullName.slice(0, 1)}</span>
          <span className="user-label"><b>{user.fullName}</b><small>{user.role === 'SUPER_ADMIN' ? 'مدير النظام' : user.role || 'موظف'}</small></span>
        </div>
      </header>
      <RouteGate />
      <div key={location.pathname} className="page-enter">{children}</div>
    </main>
  </div>;
}

/* ───────────── Dashboard ───────────── */
function Readout({ code, name, value, unit }: { code: string; name: string; value: React.ReactNode; unit?: string }) {
  return <div className="readout">
    <div className="readout-row"><span>{name}</span><em>{code}</em></div>
    <strong>{value}{unit && <small>{unit}</small>}</strong>
  </div>;
}
const count = (v: any) => v == null ? '—' : Number(v).toLocaleString('ar-EG');
function Dashboard() {
  const [d, setD] = useState<any>();
  const load = () => api('/api/v1/admin/dashboard').then(setD).catch(() => { });
  useEffect(() => { void load(); }, []);
  const steps = ['طلب', 'دفع يدوي', 'Job', 'خدمة وكونفيج', 'Marzban'];
  return <div className="page">
    <Scene scene="idle" title="نظرة عامة" sub="حالة المنصة الآن: العملاء والخدمات والراوترات والإيراد." />
    <div className="readouts">
      <Readout code="CUS" name="العملاء" value={count(d?.customers)} />
      <Readout code="SV" name="الخدمات النشطة" value={count(d?.activeServices)} />
      <Readout code="RTR" name="الراوترات المتصلة" value={count(d?.onlineRouters)} />
      <Readout code="ORD" name="إيراد الشهر" value={d ? (Number(d.revenueMinor || 0) / 100).toLocaleString('ar-EG', { maximumFractionDigits: 0 }) : '—'} unit={d ? 'EGP' : undefined} />
    </div>
    <div className="dash-grid">
      <Panel title="يحتاج تدخلك" sub="مهام توقفت بعد استنفاد المحاولات." action={<button className="btn btn-ghost" onClick={load}><RefreshCw size={15} /> تحديث</button>}>
        <div className={`attention ${(d?.attentionJobs ?? 0) > 0 ? 'hot' : ''}`}>
          <strong>{count(d?.attentionJobs ?? 0)}</strong>
          <div><b>{(d?.attentionJobs ?? 0) > 0 ? 'مهام في حالة NEEDS_ATTENTION' : 'لا توجد مهام متوقفة'}</b><p>{(d?.attentionJobs ?? 0) > 0 ? 'افتح المهام لإعادة المحاولة أو الإلغاء.' : 'كل المهام تسير بشكل طبيعي.'}</p></div>
          <NavLink className="btn btn-ghost" to="/admin/jobs">فتح المهام</NavLink>
        </div>
      </Panel>
      <Panel title="مسار الطلب" sub="من الطلب حتى إنشاء المستخدم على Marzban.">
        <ol className="gate-chain">{steps.map((s, i) => <li key={s}><span className="ring">{(i + 1).toLocaleString('ar-EG')}</span><b>{s}</b></li>)}</ol>
      </Panel>
    </div>
  </div>;
}

/* ───────────── Generic resource pages ───────────── */
type ResourceKind = 'customers' | 'services' | 'subscriptions' | 'routers' | 'servers' | 'orders' | 'payments' | 'jobs' | 'audit';
type ResourceMeta = { title: string; sub: string; scene: SceneKey; endpoint: string; cols: string[]; keys: string[] };
const meta: Record<ResourceKind, ResourceMeta> = {
  customers: { title: 'العملاء', sub: 'كل العملاء المسجلين وبيانات التواصل.', scene: 'police', endpoint: '/api/v1/admin/customers', cols: ['الكود', 'الاسم', 'البريد', 'الهاتف', 'الحالة', 'المدينة'], keys: ['public_code', 'full_name', 'email', 'mobile_phone', 'status', 'city'] },
  services: { title: 'الخدمات', sub: 'خدمات البروكسي الحية وحالتها.', scene: 'blast', endpoint: '/api/v1/admin/services', cols: ['الكود', 'العميل', 'الفئة', 'البروتوكول', 'الحالة', 'الرقم الأرضي', 'الكونفيج'], keys: ['public_code', 'customer_name', 'category', 'protocol', 'status', 'landline_number', 'config_code'] },
  subscriptions: { title: 'الاشتراكات', sub: 'مدة كل خدمة وتاريخ انتهائها.', scene: 'idle', endpoint: '/api/v1/admin/subscriptions', cols: ['الاشتراك', 'الخدمة', 'العميل', 'الفئة', 'الكونفيج', 'الراوتر', 'الحالة', 'الانتهاء'], keys: ['public_code', 'service_code', 'customer_name', 'category', 'config_code', 'router_code', 'subscription_status', 'current_period_end'] },
  routers: { title: 'الراوترات', sub: 'أجهزة OpenWrt، مالكها، واتصالها.', scene: 'router', endpoint: '/api/v1/admin/routers', cols: ['الكود', 'الموديل', 'العميل', 'الكونفيج', 'الخدمة', 'الدورة', 'الاتصال', 'آخر ظهور'], keys: ['public_code', 'model', 'customer_name', 'config_code', 'service_code', 'lifecycle_status', 'connectivity', 'last_seen_at'] },
  servers: { title: 'الخوادم', sub: 'الأجهزة ونقاط الاتصال.', scene: 'asteria', endpoint: '/api/v1/admin/servers', cols: ['الخادم', 'العنوان', 'المزوّد', 'الحالة', 'الصحة', 'النقاط'], keys: ['name', 'address', 'provider_name', 'status', 'health_status', 'endpoint_count'] },
  orders: { title: 'الطلبات', sub: 'الطلبات وحالة تنفيذها وشحنها.', scene: 'hull', endpoint: '/api/v1/admin/orders', cols: ['الطلب', 'العميل', 'العناصر', 'الإجمالي', 'الحالة', 'التاريخ'], keys: ['public_code', 'customer_name', 'item_count', 'total_minor', 'status', 'created_at'] },
  payments: { title: 'المدفوعات', sub: 'راجع التحويلات اليدوية ثم أكّدها أو ارفضها.', scene: 'vial', endpoint: '/api/v1/admin/payments', cols: ['الدفع', 'الطلب', 'العميل', 'المبلغ', 'الطريقة', 'الحالة'], keys: ['id', 'order_code', 'customer_name', 'amount_minor', 'method', 'status'] },
  jobs: { title: 'المهام', sub: 'طابور العامل ومحاولاته وأخطاؤه.', scene: 'blast', endpoint: '/api/v1/admin/jobs', cols: ['المهمة', 'النوع', 'الحالة', 'المحاولات', 'الخطأ', 'التاريخ'], keys: ['id', 'type', 'state', 'attempts', 'last_error', 'created_at'] },
  audit: { title: 'التدقيق', sub: 'كل إجراء حساس: من نفّذه ومتى.', scene: 'police', endpoint: '/api/v1/admin/audit-logs', cols: ['الوقت', 'الإجراء', 'الكيان', 'المنفذ', 'المعرف'], keys: ['occurred_at', 'action', 'entity_type', 'actor_type', 'entity_id'] }
};
const STATUS_KEYS = ['status', 'connectivity', 'state', 'lifecycle_status', 'health_status', 'subscription_status'];
const CODE_KEYS = ['public_code', 'service_code', 'config_code', 'router_code', 'order_code', 'id', 'entity_id'];
function Cell({ k, v }: { k: string; v: any }) {
  if (k.includes('minor')) return <span className="num">{money(v)}</span>;
  if (k.endsWith('_at') || k.includes('date') || k === 'current_period_end') return <span className="muted">{date(v)}</span>;
  if (STATUS_KEYS.includes(k)) return <Status v={v} />;
  if (CODE_KEYS.includes(k) && v) return <span className="code-tag">{String(v)}</span>;
  return <>{String(v ?? '—')}</>;
}
function ResourcePage({ kind, user: _user }: { kind: ResourceKind; user: User }) {
  const m = meta[kind];
  const [rows, setRows] = useState<any[]>([]); const [q, setQ] = useState(''); const [open, setOpen] = useState(false);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const load = () => { setLoading(true); setError(''); api(m.endpoint + (q ? `?q=${encodeURIComponent(q)}` : '')).then(x => setRows(Array.isArray(x) ? x : [])).catch(e => setError(e.message)).finally(() => setLoading(false)); };
  useEffect(() => { void load(); }, [q]);
  const canAdd = ['customers', 'routers', 'servers'].includes(kind);
  const hasActions = ['services', 'subscriptions', 'routers', 'servers', 'payments', 'orders'].includes(kind);
  const remove = async (kind: ResourceKind, id: string, name: string) => {
    const title = kind === 'routers' ? 'الراوتر' : kind === 'subscriptions' ? 'الاشتراك' : kind === 'services' ? 'الخدمة' : 'الخادم';
    if (!window.confirm(`حذف ${title} «${name}» نهائيًا؟`)) return;
    try { const endpoint = kind === 'routers' ? `/api/v1/admin/routers/${id}` : kind === 'subscriptions' ? `/api/v1/admin/subscriptions/${id}` : kind === 'services' ? `/api/v1/admin/services/${id}` : `/api/v1/admin/servers/hosts/${id}`; await api(endpoint, { method: 'DELETE' }); await load(); } catch (e: any) { setError(e.message); }
  };
  const act = async (confirmText: string | null, path: string, body: any = {}) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setLoading(true); setError('');
    try { await api(path, { method: 'POST', body: JSON.stringify(body) }); await load(); } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  const confirmPayment = (id: string) => act('تأكيد استلام الدفع لهذا الطلب؟ سيتم تحويل الطلب إلى مدفوع وتشغيل التجهيز تلقائيًا.', `/api/v1/admin/payments/${id}/confirm`);
  const rejectPayment = (id: string) => { const reason = window.prompt('سبب رفض الدفع:', 'لم يتم استلام/مطابقة التحويل'); if (reason === null) return; void act(null, `/api/v1/admin/payments/${id}/reject`, { reason }); };
  const shipRouterOrder = (id: string) => act('تأكيد شحن طلب الراوتر؟', `/api/v1/admin/orders/${id}/ship`);
  const deliverRouterOrder = (id: string) => act('تأكيد استلام العميل للراوتر؟ سيتم إكمال الطلب.', `/api/v1/admin/orders/${id}/deliver`);
  const colSpan = m.cols.length + (hasActions ? 1 : 0);
  return <div className="page">
    <Scene scene={m.scene} title={m.title} sub={m.sub} onAdd={canAdd ? () => setOpen(true) : undefined} />
    <Panel className="table-panel">
      <div className="toolbar">
        <label className="search"><Search size={16} /><input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} placeholder="ابحث بالاسم أو الكود…" aria-label="بحث" /></label>
        <span className="count">{loading ? '…' : `${rows.length.toLocaleString('ar-EG')} سجل`}</span>
        <button className="btn btn-ghost" onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> تحديث</button>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="table-wrap"><table>
        <thead><tr>{m.cols.map(x => <th key={x}>{x}</th>)}{hasActions && <th>إجراءات</th>}</tr></thead>
        <tbody>{loading && !rows.length ? <tr><td className="table-empty" colSpan={colSpan}><span className="scanline">جارٍ التحميل…</span></td></tr>
          : rows.length === 0 ? <tr><td className="table-empty" colSpan={colSpan}><Empty text={q ? 'لا نتائج لهذا البحث. جرّب كلمة أخرى.' : canAdd ? 'لا توجد سجلات بعد. استخدم زر الإضافة للبدء.' : 'لا توجد سجلات بعد.'} /></td></tr>
          : rows.map((r: any, i: number) => <tr key={r.id || i}>
            {m.keys.map(k => <td key={k}><Cell k={k} v={r[k]} /></td>)}
            {['services', 'subscriptions', 'routers'].includes(kind) && <td><button className="btn btn-danger btn-sm" type="button" onClick={() => void remove(kind, r.id, r.public_code || r.service_code || 'هذا العنصر')}><Trash2 size={14} /> حذف</button></td>}
            {kind === 'servers' && <td><button className="btn btn-danger btn-sm" type="button" onClick={() => void remove(kind, r.id, r.name || r.address || 'هذا الخادم')}><Trash2 size={14} /> حذف</button></td>}
            {kind === 'payments' && <td><div className="row-actions">
              {['INITIATED', 'PENDING'].includes(String(r.status)) && <><button className="btn btn-signal btn-sm" type="button" onClick={() => void confirmPayment(r.id)} disabled={loading}><Check size={14} /> تأكيد الدفع</button><button className="btn btn-danger btn-sm" type="button" onClick={() => rejectPayment(r.id)} disabled={loading}>رفض</button></>}
              {r.status === 'SUCCEEDED' && <span className="muted">تم التأكيد</span>}
              {r.status === 'FAILED' && <span className="muted">مرفوض</span>}
            </div></td>}
            {kind === 'orders' && <td><div className="row-actions">
              {r.router_only && String(r.status) === 'FULFILLING' && <button className="btn btn-signal btn-sm" type="button" onClick={() => void shipRouterOrder(r.id)} disabled={loading}>شحن الطلب</button>}
              {r.router_only && String(r.status) === 'SHIPPED' && <button className="btn btn-signal btn-sm" type="button" onClick={() => void deliverRouterOrder(r.id)} disabled={loading}>تم التسليم</button>}
            </div></td>}
          </tr>)}</tbody>
      </table></div>
    </Panel>
    {open && kind === 'customers' && <CustomerForm onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); }} />}
    {open && kind === 'routers' && <RouterForm onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); }} />}
    {open && kind === 'servers' && <ServerForm onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); }} />}
  </div>;
}

/* ───────────── Forms ───────────── */
function useSave(fn: () => Promise<void>) {
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const save = async (e: FormEvent) => { e.preventDefault(); setSaving(true); setError(''); try { await fn(); } catch (e: any) { setError(e.message); } finally { setSaving(false); } };
  return { error, saving, save };
}
function CustomerForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState<any>({});
  const { error, saving, save } = useSave(async () => { await api('/api/v1/admin/customers', { method: 'POST', body: JSON.stringify(v) }); onDone(); });
  return <Modal title="إضافة عميل" onClose={onClose}><form onSubmit={save}>
    <Field label="الاسم" value={v.fullName || ''} onChange={x => setV({ ...v, fullName: x })} />
    <Field label="البريد" value={v.email || ''} onChange={x => setV({ ...v, email: x })} type="email" />
    <Field label="الهاتف" value={v.mobilePhone || ''} onChange={x => setV({ ...v, mobilePhone: x })} />
    <div className="field-pair"><Field label="المدينة" value={v.city || ''} onChange={x => setV({ ...v, city: x })} /><Field label="المحافظة" value={v.governorate || ''} onChange={x => setV({ ...v, governorate: x })} /></div>
    {error && <div className="alert error">{error}</div>}
    <button className="btn btn-signal btn-full" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ العميل'}</button>
  </form></Modal>;
}
function RouterForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState<any>({}); const [customers, setCustomers] = useState<any[]>([]); const [configs, setConfigs] = useState<any[]>([]);
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false); const [loadingConfigs, setLoadingConfigs] = useState(false);
  useEffect(() => { void api('/api/v1/admin/customers').then(setCustomers).catch(e => setError(e.message)); }, []);
  useEffect(() => {
    if (!v.customerId) { setConfigs([]); return; }
    setLoadingConfigs(true); setError('');
    void api('/api/v1/admin/customers/' + encodeURIComponent(v.customerId) + '/configs').then((x: any[]) => setConfigs(Array.isArray(x) ? x : [])).catch(e => setError(e.message)).finally(() => setLoadingConfigs(false));
  }, [v.customerId]);
  const save = async (e: FormEvent) => { e.preventDefault(); setSaving(true); setError(''); try { await api('/api/v1/admin/routers', { method: 'POST', body: JSON.stringify(v) }); onDone(); } catch (e: any) { setError(e.message); } finally { setSaving(false); } };
  return <Modal title="تسجيل راوتر وربطه بكونفيج" onClose={onClose}><form onSubmit={save}>
    <div className="field-pair"><Field label="Serial Number" value={v.serialNumber || ''} onChange={x => setV({ ...v, serialNumber: x })} /><Field label="Device ID" value={v.deviceIdentifier || ''} onChange={x => setV({ ...v, deviceIdentifier: x })} /></div>
    <div className="field-pair"><Field label="Model" value={v.model || ''} onChange={x => setV({ ...v, model: x })} /><Field label="Firmware" value={v.openwrtVersion || ''} onChange={x => setV({ ...v, openwrtVersion: x })} /></div>
    <label className="field"><span>العميل</span><select value={v.customerId || ''} onChange={e => setV({ ...v, customerId: e.target.value, configId: '' })} required>
      <option value="">اختر العميل</option>{customers.map(c => <option key={c.id} value={c.id}>{c.full_name} — {c.public_code}</option>)}
    </select></label>
    <label className="field"><span>الكونفيج المرتبط</span><select value={v.configId || ''} onChange={e => setV({ ...v, configId: e.target.value })} required disabled={!v.customerId || loadingConfigs}>
      <option value="">{loadingConfigs ? 'جارٍ تحميل الكونفيجات…' : 'اختر الكونفيج'}</option>{configs.map(cfg => <option key={cfg.config_id} value={cfg.config_id}>{cfg.config_code} — {cfg.service_code} — {cfg.category} ({cfg.protocol})</option>)}
    </select></label>
    {v.customerId && !loadingConfigs && !configs.length && <div className="alert">لا توجد كونفيجات حالية قابلة للربط لهذا العميل. أنشئ له خدمة أولًا.</div>}
    {error && <div className="alert error">{error}</div>}
    <button className="btn btn-signal btn-full" disabled={saving || loadingConfigs || !v.customerId || !v.configId}>{saving ? 'جارٍ الحفظ…' : 'حفظ الراوتر'}</button>
  </form></Modal>;
}
function ServerForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [providers, setProviders] = useState<any[]>([]); const [v, setV] = useState<any>({ country: 'EG' });
  useEffect(() => { void api('/api/v1/admin/provider-instances').then(setProviders).catch(() => { }); }, []);
  const { error, saving, save } = useSave(async () => { await api('/api/v1/admin/servers/hosts', { method: 'POST', body: JSON.stringify(v) }); onDone(); });
  return <Modal title="إضافة خادم" onClose={onClose}><form onSubmit={save}>
    <Field label="الاسم" value={v.name || ''} onChange={x => setV({ ...v, name: x })} />
    <Field label="العنوان / IP" value={v.address || ''} onChange={x => setV({ ...v, address: x })} />
    <Field label="المدينة" value={v.city || ''} onChange={x => setV({ ...v, city: x })} />
    <label className="field"><span>المزوّد</span><select value={v.providerInstanceId || ''} onChange={e => setV({ ...v, providerInstanceId: e.target.value })}><option value="">اختر</option>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {error && <div className="alert error">{error}</div>}
    <button className="btn btn-signal btn-full" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ الخادم'}</button>
  </form></Modal>;
}

/* ───────────── Catalog (styled after the Outernet file list) ───────────── */
function Catalog() {
  const blank = { protocol: 'vless', status: 'ACTIVE', durationDays: 30, quotaPricingMode: 'FIXED', quotaStepGb: 1 };
  const [d, setD] = useState<any>({ categories: [], plans: [], routerProducts: [] }); const [kind, setKind] = useState(''); const [v, setV] = useState<any>(blank);
  const load = () => api('/api/v1/admin/catalog').then(setD).catch(() => { });
  useEffect(() => { void load(); }, []);
  const { error, saving, save } = useSave(async () => {
    const path = kind === 'category' ? '/api/v1/admin/catalog/categories' : kind === 'plan' ? '/api/v1/admin/catalog/plans' : '/api/v1/admin/catalog/router-products';
    const body = kind === 'category' ? v : kind === 'plan' ? { ...v, durationDays: Number(v.durationDays), priceMinor: v.quotaPricingMode === 'PER_GB' ? Math.round(Number(v.quotaGb || v.minQuotaGb) * Number(v.quotaPricePerGb) * 100) : Math.round(Number(v.priceMinor || 0)), quotaBytes: v.quotaGb ? Math.round(Number(v.quotaGb) * 1073741824) : null, quotaPricingMode: v.quotaPricingMode, quotaPricePerGbMinor: v.quotaPricingMode === 'PER_GB' ? Math.round(Number(v.quotaPricePerGb) * 100) : null, minQuotaGb: v.quotaPricingMode === 'PER_GB' ? Number(v.minQuotaGb) : null, maxQuotaGb: v.quotaPricingMode === 'PER_GB' && v.maxQuotaGb !== '' ? Number(v.maxQuotaGb) : null, quotaStepGb: v.quotaPricingMode === 'PER_GB' ? Number(v.quotaStepGb || 1) : 1 } : { ...v, priceMinor: Number(v.priceMinor) };
    await api(path, { method: 'POST', body: JSON.stringify(body) }); setKind(''); setV(blank); load();
  });
  const gb = (b: any) => Math.round(Number(b) / 1073741824);
  return <div className="page">
    <Scene scene="files" title="الكتالوج" sub="الفئات والباقات ومنتجات الراوتر التي يراها العميل." />
    <div className="file-columns">
      <FileList title="الفئات" codeLabel="البروتوكول" nameLabel="الفئة" items={d.categories} onAdd={() => setKind('category')} code={(x: any) => String(x.protocol || '').toUpperCase()} name={(x: any) => x.name} />
      <FileList title="الباقات" codeLabel="المدة والحصة" nameLabel="الباقة" items={d.plans} onAdd={() => setKind('plan')} code={(x: any) => `${x.duration_days ?? '—'} يوم${x.quota_bytes ? ` / ${gb(x.quota_bytes)} GB` : ''}${x.quota_pricing_mode === 'PER_GB' ? ' / سعر لكل GB' : ''}`} name={(x: any) => x.name} extra={(x: any) => money(x.price_minor)} />
      <FileList title="منتجات الراوتر" codeLabel="SKU" nameLabel="المنتج" items={d.routerProducts} onAdd={() => setKind('router')} code={(x: any) => x.sku || x.model} name={(x: any) => x.name} extra={(x: any) => money(x.price_minor)} />
    </div>
    {kind && <Modal title={kind === 'category' ? 'فئة جديدة' : kind === 'plan' ? 'باقة جديدة' : 'منتج راوتر جديد'} onClose={() => setKind('')}><form onSubmit={save}>
      {kind === 'category' ? <>
        <Field label="الاسم" value={v.name || ''} onChange={x => setV({ ...v, name: x })} />
        <Field label="Slug" value={v.slug || ''} onChange={x => setV({ ...v, slug: x })} />
        <label className="field"><span>البروتوكول</span><select value={v.protocol} onChange={e => setV({ ...v, protocol: e.target.value })}><option value="vless">VLESS</option><option value="vmess">VMess</option></select></label>
      </> : kind === 'plan' ? <>
        <label className="field"><span>الفئة</span><select value={v.categoryId || ''} onChange={e => setV({ ...v, categoryId: e.target.value })} required><option value="">اختر</option>{d.categories.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <Field label="اسم الباقة" value={v.name || ''} onChange={x => setV({ ...v, name: x })} />
        <Field label="المدة بالأيام" value={v.durationDays} onChange={x => setV({ ...v, durationDays: x })} type="number" />
        <label className="field"><span>نوع تسعير الجيجا</span><select value={v.quotaPricingMode} onChange={e => setV({ ...v, quotaPricingMode: e.target.value })}><option value="FIXED">حصة ثابتة</option><option value="PER_GB">سعر حسب الجيجا</option></select></label>
        {v.quotaPricingMode === 'FIXED' ? <div className="field-pair">
          <Field label="السعر بالجنيه" value={v.priceMinor ? Number(v.priceMinor) / 100 : ''} onChange={x => setV({ ...v, priceMinor: Math.round(Number(x) * 100) })} type="number" />
          <Field label="الحصة GB" value={v.quotaGb || ''} onChange={x => setV({ ...v, quotaGb: x })} type="number" />
        </div> : <>
          <div className="field-pair"><Field label="السعر لكل GB بالجنيه" value={v.quotaPricePerGb || ''} onChange={x => setV({ ...v, quotaPricePerGb: x })} type="number" /><Field label="الحصة الافتراضية GB" value={v.quotaGb || ''} onChange={x => setV({ ...v, quotaGb: x })} type="number" /></div>
          <div className="field-pair"><Field label="الحد الأدنى GB" value={v.minQuotaGb || ''} onChange={x => setV({ ...v, minQuotaGb: x })} type="number" /><Field label="الحد الأقصى GB" value={v.maxQuotaGb || ''} onChange={x => setV({ ...v, maxQuotaGb: x })} type="number" /></div>
          <Field label="الزيادة GB" value={v.quotaStepGb || 1} onChange={x => setV({ ...v, quotaStepGb: x })} type="number" />
        </>}
      </> : <>
        <div className="field-pair"><Field label="SKU" value={v.sku || ''} onChange={x => setV({ ...v, sku: x })} /><Field label="الموديل" value={v.model || ''} onChange={x => setV({ ...v, model: x })} /></div>
        <Field label="الاسم" value={v.name || ''} onChange={x => setV({ ...v, name: x })} />
        <Field label="السعر بالقرش" value={v.priceMinor} onChange={x => setV({ ...v, priceMinor: x })} type="number" />
      </>}
      {error && <div className="alert error">{error}</div>}
      <button className="btn btn-signal btn-full" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ'}</button>
    </form></Modal>}
  </div>;
}
function FileList({ title, items, onAdd, codeLabel, nameLabel, code, name, extra }: { title: string; items: any[]; onAdd: () => void; codeLabel: string; nameLabel: string; code: (x: any) => string; name: (x: any) => string; extra?: (x: any) => string }) {
  return <section className="panel file-list">
    <div className="panel-head"><div><h2>{title}</h2><p>{items.length.toLocaleString('ar-EG')} عنصر</p></div><button className="icon-btn signal" onClick={onAdd} aria-label={`إضافة إلى ${title}`}><Plus size={18} /></button></div>
    {items.slice(0, 12).map((x, i) => <div className="file-row" key={x.id || i}>
      <div className="file-line"><span>{codeLabel}</span><em>{code(x)}</em></div>
      <div className="file-line"><span>{nameLabel}</span><strong>{name(x)}</strong>{extra && <b className="file-extra">{extra(x)}</b>}</div>
    </div>)}
    {!items.length && <Empty text={`لا توجد ${title} بعد. اضغط + لإضافة أول عنصر.`} />}
  </section>;
}

/* ───────────── Customer portal ───────────── */
function ConfigLink({ link, onClose }: { link: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { } };
  return <div className="config-link">
    <div className="config-link-head"><b>رابط الكونفيج</b><button className="icon-btn" onClick={onClose} aria-label="إخفاء الرابط"><X size={16} /></button></div>
    <code dir="ltr">{link}</code>
    <button className="btn btn-signal" onClick={copy}>{copied ? <><Check size={15} /> تم النسخ</> : <><Copy size={15} /> نسخ الرابط</>}</button>
  </div>;
}
function CustomerPortal({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [cats, setCats] = useState<any[]>([]); const [services, setServices] = useState<any[]>([]); const [orders, setOrders] = useState<any[]>([]);
  const [landlines, setLandlines] = useState<any[]>([]); const [selectedLandline, setSelectedLandline] = useState('');
  const [landlineNumber, setLandlineNumber] = useState(''); const [landlineLabel, setLandlineLabel] = useState('');
  const [quotaByPlan, setQuotaByPlan] = useState<Record<string, string>>({}); const [msg, setMsg] = useState(''); const [link, setLink] = useState('');
  const load = () => {
    api('/api/v1/customer/catalog/categories').then(setCats).catch(() => { });
    api('/api/v1/customer/services').then(setServices).catch(() => { });
    api('/api/v1/customer/orders').then(setOrders).catch(() => { });
    api('/api/v1/customer/landlines').then((x: any[]) => { setLandlines(x); if (!selectedLandline && x[0]?.id) setSelectedLandline(x[0].id); }).catch(() => { });
  };
  const addLandline = async (e: FormEvent) => { e.preventDefault(); try { await api('/api/v1/customer/landlines', { method: 'POST', body: JSON.stringify({ number: landlineNumber, label: landlineLabel }) }); setLandlineNumber(''); setLandlineLabel(''); setMsg('تمت إضافة الرقم الأرضي.'); load(); } catch (e: any) { setMsg(e.message); } };
  const removeLandline = async (id: string) => { if (!confirm('حذف الرقم؟')) return; try { await api('/api/v1/customer/landlines/' + id, { method: 'DELETE' }); if (selectedLandline === id) setSelectedLandline(''); load(); } catch (e: any) { setMsg(e.message); } };
  useEffect(() => { void load(); }, []);
  const quotaFor = (p: any) => quotaByPlan[p.id] || Math.round(Number(p.quotaBytes || 0) / 1073741824) || p.minQuotaGb || 1;
  const order = async (plan: any) => {
    if (!selectedLandline) { setMsg('اختر رقمًا أرضيًا أولًا.'); return; }
    const quotaGb = plan.quotaPricingMode === 'PER_GB' ? Number(quotaByPlan[plan.id] || Math.round(Number(plan.quotaBytes || 0) / 1073741824) || plan.minQuotaGb) : undefined;
    try {
      const key = crypto.randomUUID();
      const o = await api('/api/v1/customer/orders', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ items: [{ type: 'CONFIG_NEW', planId: plan.id, landlineId: selectedLandline, quotaGb }] }) });
      await api(`/api/v1/customer/orders/${o.id}/pay`, { method: 'POST', body: JSON.stringify({}) });
      setMsg(`تم إنشاء الطلب ${o.public_code}. سيتم تفعيله بعد تأكيد الإدارة للدفع.`); load();
    } catch (e: any) { setMsg(e.message); }
  };
  const reveal = async (id: string) => { try { const x = await api(`/api/v1/customer/services/${id}/config`); setLink(x.link); } catch (e: any) { setMsg(e.message); } };
  const plans = cats.flatMap((c: any) => (c.plans || []).map((p: any) => ({ ...p, categoryName: c.name })));
  return <div className="portal">
    <header className="portal-top">
      <div className="portal-brand"><Logo size={38} /><b>CowboyBepob</b></div>
      <div className="portal-user"><span>{user.fullName}</span><button className="btn btn-ghost" onClick={onLogout}><LogOut size={15} /> خروج</button></div>
    </header>
    <section className="portal-hero">
      <img src="/bebop/mars.webp" alt="" />
      <div className="scene-bars" aria-hidden><span /><span /><span /></div>
      <div className="portal-hero-text">
        <h1>أهلًا، {user.fullName.split(' ')[0]}</h1>
        <p>اختر باقة، اربطها برقمك الأرضي، وتابع خدماتك من هنا.</p>
      </div>
    </section>
    <div className="portal-body">
      {msg && <div className="alert" role="status">{msg}<button className="icon-btn" onClick={() => setMsg('')} aria-label="إغلاق"><X size={14} /></button></div>}
      {link && <ConfigLink link={link} onClose={() => setLink('')} />}

      <Panel title="خدماتي" sub={services.length ? `${services.length.toLocaleString('ar-EG')} خدمة` : undefined}>
        <div className="ship-grid">{services.map(s => <article className="ship" key={s.id}>
          <div className="ship-img"><img src={s.router_code ? '/bebop/router-708.webp' : '/bebop/gate-idle.webp'} alt="" /><Status v={s.status} /></div>
          <div className="ship-body">
            <span className="code-tag">{s.public_code}</span>
            <h3>{s.label || s.category_name}</h3>
            <dl>
              <div><dt>الراوتر</dt><dd>{s.router_code || 'غير مربوط'}</dd></div>
              <div><dt>الكونفيج</dt><dd>{s.config_code || '—'}</dd></div>
              <div><dt>ينتهي</dt><dd>{date(s.current_period_end)}</dd></div>
            </dl>
            {s.status === 'ACTIVE' && <button className="btn btn-ghost btn-full" onClick={() => reveal(s.id)}>عرض الرابط</button>}
          </div>
        </article>)}{!services.length && <Empty text="لا توجد خدمات بعد. اختر باقة من الأسفل لتبدأ." />}</div>
      </Panel>

      <Panel title="أرقامي الأرضية" sub="كل كونفيج جديد يُربط برقم أرضي.">
        <form className="landline-form" onSubmit={addLandline}>
          <label className="field"><span>الرقم</span><input value={landlineNumber} onChange={e => setLandlineNumber(e.target.value)} placeholder="0225551111" inputMode="tel" dir="ltr" required /></label>
          <label className="field"><span>اسم اختياري</span><input value={landlineLabel} onChange={e => setLandlineLabel(e.target.value)} placeholder="البيت" /></label>
          <button className="btn btn-signal">إضافة رقم</button>
        </form>
        <div className="landlines">{landlines.map((l: any) => <label key={l.id} className={`landline ${selectedLandline === l.id ? 'on' : ''}`}>
          <input type="radio" name="landline" checked={selectedLandline === l.id} onChange={() => setSelectedLandline(l.id)} />
          <b dir="ltr">{l.number}</b><span>{l.label || ''}</span>
          <button type="button" className="icon-btn danger" onClick={() => removeLandline(l.id)} aria-label={`حذف ${l.number}`}><Trash2 size={14} /></button>
        </label>)}{!landlines.length && <p className="muted">أضف رقمك الأرضي أولًا لتتمكن من الطلب.</p>}</div>
      </Panel>

      <Panel title="الباقات المتاحة" sub={selectedLandline ? 'الطلب سيُربط بالرقم المحدد أعلاه.' : 'حدد رقمًا أرضيًا لتفعيل الطلب.'}>
        <div className="passes">{plans.map((p: any) => <article className="pass" key={p.id}>
          <div className="pass-main">
            <span className="pass-cat">{p.categoryName}</span>
            <h3>{p.name}</h3>
            <div className="pass-meta"><span>{p.durationDays} يوم</span><span>{p.quotaPricingMode === 'PER_GB' ? `${money(p.quotaPricePerGbMinor, p.currency)} لكل GB` : p.quotaBytes ? `${Math.round(Number(p.quotaBytes) / 1073741824)} GB` : 'بدون حصة محددة'}</span></div>
            {p.quotaPricingMode === 'PER_GB' && <label className="field"><span>حجم الاشتراك بالـGB</span><input type="number" min={p.minQuotaGb || 1} max={p.maxQuotaGb || undefined} step={p.quotaStepGb || 1} value={quotaFor(p)} onChange={e => setQuotaByPlan({ ...quotaByPlan, [p.id]: e.target.value })} /></label>}
          </div>
          <div className="pass-stub">
            <strong>{p.quotaPricingMode === 'PER_GB' ? money(Number(quotaFor(p)) * Number(p.quotaPricePerGbMinor || 0), p.currency) : money(p.priceMinor, p.currency)}</strong>
            <button className="btn btn-signal btn-full" disabled={!selectedLandline} onClick={() => order(p)}>اطلب الآن</button>
          </div>
        </article>)}{!plans.length && <Empty text="لا توجد باقات متاحة حاليًا. عُد لاحقًا." />}</div>
      </Panel>

      <Panel title="طلباتي">
        <div className="orders">{orders.map(o => <div className="order-row" key={o.id}><span className="code-tag">{o.public_code}</span><Status v={o.status} /><b className="num">{money(o.total_minor, o.currency)}</b></div>)}{!orders.length && <p className="muted">لم تطلب شيئًا بعد.</p>}</div>
      </Panel>
    </div>
  </div>;
}

/* ───────────── Infra pages ───────────── */
function SimpleTable({ head, rows, empty }: { head: string[]; rows: React.ReactNode[]; empty: string }) {
  return <div className="table-wrap"><table><thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{rows.length ? rows : <tr><td className="table-empty" colSpan={head.length}><Empty text={empty} /></td></tr>}</tbody></table></div>;
}
function ServersPage() {
  const [rows, setRows] = useState<any[]>([]); const [open, setOpen] = useState(false); const [error, setError] = useState('');
  const load = () => api('/api/v1/admin/servers').then(setRows).catch(e => setError(e.message));
  useEffect(() => { void load(); }, []);
  const remove = async (id: string) => { if (!confirm('حذف الخادم؟ سيتم حذف الـendpoints الخاصة به إذا لم تكن مرتبطة بتخصيصات.')) return; try { await api(`/api/v1/admin/servers/hosts/${id}`, { method: 'DELETE' }); load(); } catch (e: any) { setError(e.message); } };
  return <div className="page">
    <Scene scene="asteria" title="الخوادم" sub="كل خادم بوابة: عنوانه ومزوّده وصحته." onAdd={() => setOpen(true)} addText="إضافة خادم" />
    <Panel className="table-panel">
      {error && <div className="alert error">{error}</div>}
      <div className="toolbar"><span className="count">{rows.length.toLocaleString('ar-EG')} خادم</span><button className="btn btn-ghost" onClick={load}><RefreshCw size={15} /> تحديث</button></div>
      <SimpleTable head={['الخادم', 'العنوان', 'المزوّد', 'الحالة', 'الصحة', 'النقاط', '']} empty="لا توجد خوادم بعد. أضف أول خادم." rows={rows.map(r => <tr key={r.id}><td><b>{r.name}</b></td><td dir="ltr" className="mono-ish">{r.address}</td><td>{r.provider_name}</td><td><Status v={r.status} /></td><td><Status v={r.health_status} /></td><td className="num">{r.endpoint_count}</td><td><button className="btn btn-danger btn-sm" onClick={() => remove(r.id)}><Trash2 size={14} /> حذف</button></td></tr>)} />
    </Panel>
    {open && <ServerForm onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); }} />}
  </div>;
}
function ProvidersPage() {
  const [rows, setRows] = useState<any[]>([]); const [error, setError] = useState('');
  const load = () => api('/api/v1/admin/provider-instances').then(setRows).catch(e => setError(e.message));
  useEffect(() => { void load(); }, []);
  const remove = async (id: string) => { if (!confirm('حذف الـProvider؟')) return; try { await api(`/api/v1/admin/provider-instances/${id}`, { method: 'DELETE' }); load(); } catch (e: any) { setError(e.message); } };
  return <div className="page">
    <Scene scene="mars" title="المزوّدون" sub="لوحات Marzban المتصلة. بيانات الدخول مخزنة مشفرة." />
    <Panel className="table-panel">
      {error && <div className="alert error">{error}</div>}
      <SimpleTable head={['الاسم', 'النوع', 'Base URL', 'الحالة', 'بيانات الدخول', '']} empty="لا يوجد مزوّد. أضفه بـ npm run provider:add على السيرفر." rows={rows.map(r => <tr key={r.id}><td><b>{r.name}</b></td><td>{r.type}</td><td dir="ltr" className="mono-ish">{r.base_url}</td><td><Status v={r.status} /></td><td>{r.has_credentials ? <Status v="ACTIVE" /> : <span className="status bad"><i />غير موجودة</span>}</td><td><button className="btn btn-danger btn-sm" onClick={() => remove(r.id)}><Trash2 size={14} /> حذف</button></td></tr>)} />
    </Panel>
  </div>;
}
function ConfigsPage() {
  const [rows, setRows] = useState<any[]>([]); const [error, setError] = useState('');
  const load = () => api('/api/v1/admin/configs').then(setRows).catch(e => setError(e.message));
  useEffect(() => { void load(); }, []);
  const remove = async (id: string) => { if (!confirm('حذف الكونفيج؟')) return; try { await api(`/api/v1/admin/configs/${id}`, { method: 'DELETE' }); load(); } catch (e: any) { setError(e.message); } };
  return <div className="page">
    <Scene scene="files" title="الكونفيجات" sub="كل نسخة كونفيج والخدمة التي تتبعها." />
    <Panel className="table-panel">
      {error && <div className="alert error">{error}</div>}
      <div className="toolbar"><span className="count">{rows.length.toLocaleString('ar-EG')} كونفيج</span><button className="btn btn-ghost" onClick={load}><RefreshCw size={15} /> تحديث</button></div>
      <SimpleTable head={['الكونفيج', 'الخدمة', 'الحالة', 'البروتوكول', 'النسخة', 'التاريخ', '']} empty="لا توجد كونفيجات بعد." rows={rows.map(r => <tr key={r.id}><td><span className="code-tag">{r.public_code}</span></td><td><span className="code-tag">{r.service_code}</span></td><td><Status v={r.status} /></td><td>{String(r.protocol || '').toUpperCase()}</td><td className="num">{r.version}</td><td className="muted">{date(r.created_at)}</td><td><button className="btn btn-danger btn-sm" onClick={() => remove(r.id)}><Trash2 size={14} /> حذف</button></td></tr>)} />
    </Panel>
  </div>;
}
function SettingsPage() {
  const [d, setD] = useState<any[]>([]);
  useEffect(() => { void api('/api/v1/admin/settings').then(setD).catch(() => { }); }, []);
  return <div className="page">
    <Scene scene="hull" title="الإعدادات" sub="قيم التشغيل الحالية للمنصة (قراءة فقط)." />
    <Panel className="table-panel"><SimpleTable head={['المفتاح', 'القيمة', 'آخر تحديث']} empty="لا توجد إعدادات محفوظة." rows={d.map(x => <tr key={x.key}><td dir="ltr" className="mono-ish">{x.key}</td><td><code dir="ltr">{JSON.stringify(x.value)}</code></td><td className="muted">{date(x.updated_at)}</td></tr>)} /></Panel>
  </div>;
}

/* ───────────── App ───────────── */
function App() {
  const [user, setUser] = useState<User | null>(null); const [jumping, setJumping] = useState<User | null>(null); const [booted, setBooted] = useState(false);
  const nav = useNavigate();
  useEffect(() => { void api('/api/v1/auth/me').then(x => x.user && setUser(x.user)).catch(() => { }).finally(() => setBooted(true)); }, []);
  const logout = async () => { try { await api('/api/v1/auth/logout', { method: 'POST' }); } finally { setUser(null); nav('/login'); } };
  const land = (u: User) => { setJumping(null); setUser(u); nav(u.type === 'STAFF' ? '/admin' : '/customer'); };
  if (!booted) return <div className="boot"><Logo size={72} /></div>;
  if (jumping) return <GateJump onDone={() => land(jumping)} />;
  if (!user) return <Routes><Route path="*" element={<Login onLogin={u => setJumping(u)} />} /></Routes>;
  if (user.type === 'CUSTOMER') return <Routes><Route path="*" element={<CustomerPortal user={user} onLogout={logout} />} /></Routes>;
  return <Shell user={user} onLogout={logout}><Routes>
    <Route path="/admin" element={<Dashboard />} />
    <Route path="/admin/customers" element={<ResourcePage kind="customers" user={user} />} />
    <Route path="/admin/services" element={<ResourcePage kind="services" user={user} />} />
    <Route path="/admin/subscriptions" element={<ResourcePage kind="subscriptions" user={user} />} />
    <Route path="/admin/routers" element={<ResourcePage kind="routers" user={user} />} />
    <Route path="/admin/servers" element={<ServersPage />} />
    <Route path="/admin/providers" element={<ProvidersPage />} />
    <Route path="/admin/configs" element={<ConfigsPage />} />
    <Route path="/admin/catalog" element={<Catalog />} />
    <Route path="/admin/orders" element={<ResourcePage kind="orders" user={user} />} />
    <Route path="/admin/payments" element={<ResourcePage kind="payments" user={user} />} />
    <Route path="/admin/jobs" element={<ResourcePage kind="jobs" user={user} />} />
    <Route path="/admin/audit" element={<ResourcePage kind="audit" user={user} />} />
    <Route path="/admin/settings" element={<SettingsPage />} />
    <Route path="*" element={<Dashboard />} />
  </Routes></Shell>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>);
