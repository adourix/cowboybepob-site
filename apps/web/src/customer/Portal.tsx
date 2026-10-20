import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, Box, ChevronDown, CreditCard, Home, Layers, LogOut, MapPin, Network, Phone, Router as RouterIcon, Settings, ShoppingCart, User as UserIcon } from 'lucide-react';
import { api, shortName, User } from '../lib/api';
import { CustomerService, normalizeService } from './selection';
import { Dashboard } from './pages/Dashboard';
import { ConfigsPage } from './pages/Configs';
import { OrdersPage } from './pages/Orders';
import { ServicesShop } from './pages/ServicesShop';
import { RoutersShop } from './pages/RoutersShop';
import { AddressPage, DevicesPage, PaymentsPage, PhonesPage, ProfilePage, SettingsPage, UsagePage } from './pages/Account';
import { PaymentReturn } from './PaymentFlow';

export type Profile = { id: string; public_code: string; full_name: string; email: string; mobile_phone: string; address_line: string; city: string; governorate: string | null; created_at?: string };
export type PortalData = {
  user: User; profile: Profile | null; services: CustomerService[]; routers: any[]; orders: any[]; landlines: any[];
  categories: any[]; routerProducts: any[]; loading: boolean; error: string; refresh: () => Promise<void>; logout: () => void;
};
const Ctx = createContext<PortalData | null>(null);
export const usePortal = () => { const v = useContext(Ctx); if (!v) throw new Error('usePortal outside portal'); return v; };

const TABS = [
  ['/customer', 'الرئيسية', Home],
  ['/customer/orders', 'الطلبات', ShoppingCart],
  ['/customer/services', 'الخدمات', Layers],
  ['/customer/routers', 'الراوترات', RouterIcon],
] as const;
export const ACCOUNT_NAV = [
  ['/customer/profile', 'الملف الشخصي', UserIcon],
  ['/customer/phones', 'أرقام الهاتف', Phone],
  ['/customer/configs', 'كل الكونفيجات', Box],
  ['/customer/settings', 'الإعدادات', Settings],
  ['/customer/payments', 'المدفوعات', CreditCard],
  ['/customer/address', 'عنوان الشحن', MapPin],
  ['/customer/devices', 'أجهزتي', Network],
  ['/customer/usage', 'الاستخدام والفواتير', BarChart3],
] as const;

function Brand() {
  return <NavLink to="/customer" className="cx-brand" aria-label="CowboyBepob — الرئيسية">
    <img src="/bebop/logo.png" alt="" width={58} height={58} />
    <span><b>CowboyBepob</b><small className="en">INTERNET BEYOND BORDERS</small></span>
    <i className="hazard" aria-hidden />
  </NavLink>;
}

function UserMenu() {
  const { user, profile, landlines, logout } = usePortal();
  const [open, setOpen] = useState(false); const [phones, setPhones] = useState(false); const ref = useRef<HTMLDivElement>(null);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const first = shortName(user.fullName);
  return <div className="cx-user" ref={ref}>
    <button className="cx-user-chip" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu">
      <img src="/bebop/logo.png" alt="" width={44} height={44} />
      <span><b>{first}</b><small>عميل</small></span>
      <ChevronDown size={18} className={open ? 'flip' : ''} />
    </button>
    {open && <div className="cx-menu" role="menu">
      <div className="cx-menu-id"><img src="/bebop/logo.png" alt="" width={56} height={56} /><div><b>{user.fullName}</b><small>عميل</small><span dir="ltr">{user.email}</span></div></div>
      <NavLink to="/customer/profile" role="menuitem"><UserIcon size={18} />الملف الشخصي</NavLink>
      <button className={`cx-menu-toggle ${phones ? 'on' : ''}`} onClick={() => setPhones(p => !p)} aria-expanded={phones}><Phone size={18} />أرقام الهاتف<ChevronDown size={16} /></button>
      {phones && <div className="cx-menu-phones">
        {profile && <span dir="ltr" className="primary">{localMobile(profile.mobile_phone)} <em>(الأساسي)</em></span>}
        {landlines.map(l => <span key={l.id} dir="ltr">{l.number}</span>)}
        <NavLink to="/customer/phones">+ إضافة رقم جديد</NavLink>
      </div>}
      {ACCOUNT_NAV.slice(3).map(([to, t, I]) => <NavLink key={to} to={to} role="menuitem"><I size={18} />{t}</NavLink>)}
      <button className="cx-menu-out" onClick={logout} role="menuitem"><LogOut size={18} />تسجيل الخروج</button>
    </div>}
  </div>;
}
export const localMobile = (m?: string | null) => { if (!m) return '—'; const d = m.replace(/[^0-9]/g, ''); return d.startsWith('20') ? '0' + d.slice(2) : d; };

export function AccountLayout({ children }: { children: React.ReactNode }) {
  return <div className="cx-account">
    <nav className="cx-side" aria-label="حسابي">
      <div className="hud hud-gold"><div className="hud-in">
        <h2>حسابي</h2>
        {ACCOUNT_NAV.map(([to, t, I]) => <NavLink key={to} to={to} className={({ isActive }) => 'cx-side-link' + (isActive ? ' on' : '')}><I size={19} /><span>{t}</span></NavLink>)}
      </div></div>
    </nav>
    <div className="cx-account-main">{children}</div>
  </div>;
}

export function CustomerPortal({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [state, setState] = useState<Omit<PortalData, 'user' | 'refresh' | 'logout'>>({ profile: null, services: [], routers: [], orders: [], landlines: [], categories: [], routerProducts: [], loading: true, error: '' });
  const refresh = useCallback(async () => {
    // One request per resource; config links are NOT fetched here (reveal is audited, on demand only).
    const [profile, services, routers, orders, landlines, categories, routerProducts] = await Promise.allSettled([
      api('/api/v1/customer/profile'), api('/api/v1/customer/services'), api('/api/v1/customer/routers'), api('/api/v1/customer/orders'),
      api('/api/v1/customer/landlines'), api('/api/v1/customer/catalog/categories'), api('/api/v1/customer/catalog/router-products')]);
    const v = (r: PromiseSettledResult<any>, d: any) => r.status === 'fulfilled' && r.value != null ? r.value : d;
    const failed = [profile, services, orders].some(r => r.status === 'rejected');
    setState({ profile: v(profile, null), services: (v(services, []) as any[]).map(normalizeService), routers: v(routers, []), orders: v(orders, []), landlines: v(landlines, []), categories: v(categories, []), routerProducts: v(routerProducts, []), loading: false, error: failed ? 'تعذر تحميل بعض البيانات. تحقق من الاتصال ثم حدّث الصفحة.' : '' });
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const value = useMemo<PortalData>(() => ({ ...state, user, refresh, logout: onLogout }), [state, user, refresh, onLogout]);
  const loc = useLocation();
  return <Ctx.Provider value={value}>
    <div className="cx">
      <header className="cx-top">
        <Brand />
        <nav className="cx-tabs" aria-label="القائمة الرئيسية">
          {TABS.map(([to, t, I]) => <NavLink key={to} to={to} end={to === '/customer'} className={({ isActive }) => 'cx-tab' + (isActive ? ' on' : '')}><I size={26} strokeWidth={1.6} /><span>{t}</span></NavLink>)}
        </nav>
        <UserMenu />
      </header>
      {state.error && <div className="cx-alert bad" role="alert">{state.error}</div>}
      <main key={loc.pathname} className="cx-page">
        <Routes>
          <Route path="/customer" element={<Dashboard />} />
          <Route path="/customer/orders" element={<OrdersPage />} />
          <Route path="/customer/services" element={<ServicesShop />} />
          <Route path="/customer/routers" element={<RoutersShop />} />
          <Route path="/customer/configs" element={<ConfigsPage />} />
          <Route path="/customer/profile" element={<ProfilePage />} />
          <Route path="/customer/phones" element={<PhonesPage />} />
          <Route path="/customer/settings" element={<SettingsPage />} />
          <Route path="/customer/payments" element={<PaymentsPage />} />
          <Route path="/customer/address" element={<AddressPage />} />
          <Route path="/customer/devices" element={<DevicesPage />} />
          <Route path="/customer/usage" element={<UsagePage />} />
          <Route path="/customer/payments/return" element={<PaymentReturn />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </main>
      <footer className="cx-foot en"><span>PLAN · CONNECT · ROUTE · EXPLORE</span><i className="hazard" aria-hidden /><span>COWBOY BEBOP · INTERNET BEYOND BORDERS</span></footer>
    </div>
  </Ctx.Provider>;
}
export const useNav = () => useNavigate();
