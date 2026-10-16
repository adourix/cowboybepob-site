import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import {
  Activity, ArrowDownLeft, ArrowUpLeft, Bell, Boxes, CircleHelp, CreditCard,
  Gauge, Globe2, HardDrive, LayoutGrid, LogOut, Menu, Network, Package,
  Search, Settings, ShieldCheck, ShoppingCart, Users, Wifi, Workflow
} from "lucide-react";
import "./styles.css";

type NavItem = { label: string; to: string; icon: React.ComponentType<{size?: number}> };

const mainNav: NavItem[] = [
  { label: "نظرة عامة", to: "/admin", icon: Gauge },
  { label: "العملاء", to: "/admin/customers", icon: Users },
  { label: "الخدمات", to: "/admin/services", icon: Wifi },
  { label: "الراوترات", to: "/admin/routers", icon: Network },
  { label: "الخوادم", to: "/admin/servers", icon: HardDrive },
  { label: "كتالوج الخدمات", to: "/admin/catalog", icon: Package },
  { label: "الطلبات", to: "/admin/orders", icon: ShoppingCart },
  { label: "المدفوعات", to: "/admin/payments", icon: CreditCard },
  { label: "المهام", to: "/admin/jobs", icon: Workflow },
  { label: "سجل التدقيق", to: "/admin/audit", icon: ShieldCheck },
];

const pageTitles: Record<string, string> = {
  "/admin": "نظرة عامة",
  "/admin/customers": "العملاء",
  "/admin/services": "الخدمات",
  "/admin/routers": "الراوترات",
  "/admin/servers": "الخوادم",
  "/admin/catalog": "كتالوج الخدمات",
  "/admin/orders": "الطلبات",
  "/admin/payments": "المدفوعات",
  "/admin/jobs": "المهام",
  "/admin/audit": "سجل التدقيق",
  "/customer": "بوابة العميل",
  "/customer/services": "خدماتي",
  "/customer/routers": "أجهزتي",
};

const sampleRows: Record<string, string[][]> = {
  "/admin/customers": [["C-1028", "أحمد محمد", "ahmed@example.com", "نشط", "منذ 4 دقائق"], ["C-1027", "محمود علي", "mahmoud@example.com", "نشط", "منذ 21 دقيقة"], ["C-1026", "سارة حسن", "sara@example.com", "معلّق", "منذ ساعة"]],
  "/admin/services": [["SVC-2104", "باقة منزلية", "VLESS", "مفعّلة", "2026/11/12"], ["SVC-2103", "باقة أعمال", "VMess", "مفعّلة", "2026/11/01"], ["SVC-2102", "باقة تجريبية", "VLESS", "منتهية", "2026/10/10"]],
  "/admin/routers": [["RTR-011", "راوتر المكتب", "OpenWrt", "متصل", "10.0.0.1"], ["RTR-010", "راوتر المنزل", "OpenWrt", "متصل", "10.0.0.2"], ["RTR-009", "فرع دمياط", "OpenWrt", "غير متصل", "10.0.0.3"]],
  "/admin/servers": [["SRV-001", "Node Cairo 01", "Marzban", "سليم", "18%"], ["SRV-002", "Node Frankfurt", "Marzban", "سليم", "43%"], ["SRV-003", "Node Backup", "Marzban", "تحذير", "87%"]],
  "/admin/catalog": [["PLAN-01", "الباقة الأساسية", "30 يومًا", "150 ج.م", "منشورة"], ["PLAN-02", "الباقة المتقدمة", "90 يومًا", "390 ج.م", "منشورة"], ["PLAN-03", "باقة الشركات", "180 يومًا", "900 ج.م", "مسودة"]],
  "/admin/orders": [["ORD-2041", "أحمد محمد", "الباقة الأساسية", "150 ج.م", "مكتمل"], ["ORD-2040", "سارة حسن", "الباقة المتقدمة", "390 ج.م", "قيد التنفيذ"], ["ORD-2039", "محمود علي", "الباقة الأساسية", "150 ج.م", "بانتظار الدفع"]],
  "/admin/payments": [["PAY-881", "ORD-2041", "150 ج.م", "تحويل يدوي", "مقبول"], ["PAY-880", "ORD-2040", "390 ج.م", "بوابة دفع", "مراجعة"], ["PAY-879", "ORD-2039", "150 ج.م", "تحويل يدوي", "مرفوض"]],
  "/admin/jobs": [["JOB-041", "مزامنة راوتر", "RTR-011", "اكتملت", "00:00:12"], ["JOB-040", "تفعيل خدمة", "SVC-2104", "قيد التنفيذ", "00:00:04"], ["JOB-039", "مزامنة خادم", "SRV-003", "فشلت", "00:00:31"]],
  "/admin/audit": [["AUD-504", "تعديل باقة", "admin@example.com", "كتالوج الخدمات", "منذ دقيقتين"], ["AUD-503", "تسجيل دخول", "staff@example.com", "المصادقة", "منذ 19 دقيقة"], ["AUD-502", "إضافة راوتر", "admin@example.com", "الراوترات", "منذ ساعة"]],
};

const columnHeaders: Record<string, string[]> = {
  "/admin/customers": ["المعرف", "الاسم", "البريد الإلكتروني", "الحالة", "آخر نشاط"],
  "/admin/services": ["المعرف", "اسم الخدمة", "البروتوكول", "الحالة", "الانتهاء"],
  "/admin/routers": ["المعرف", "الاسم", "النظام", "الاتصال", "عنوان الشبكة"],
  "/admin/servers": ["المعرف", "الخادم", "المزوّد", "الحالة", "استهلاك CPU"],
  "/admin/catalog": ["المعرف", "اسم الباقة", "المدة", "السعر", "النشر"],
  "/admin/orders": ["رقم الطلب", "العميل", "العنصر", "الإجمالي", "الحالة"],
  "/admin/payments": ["المعرف", "رقم الطلب", "المبلغ", "الطريقة", "الحالة"],
  "/admin/jobs": ["المعرف", "نوع المهمة", "المورد", "الحالة", "المدة"],
  "/admin/audit": ["المعرف", "الحدث", "المنفّذ", "النطاق", "الوقت"],
};

function Sidebar() {
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark"><Globe2 size={21}/></div><div><strong>CowboyBepob</strong><span>إدارة المنصة</span></div></div>
    <div className="workspace"><span className="workspace-dot" /> بيئة الإنتاج التجريبية <span className="chevron">⌄</span></div>
    <div className="nav-caption">القائمة الرئيسية</div>
    <nav>{mainNav.map(({label,to,icon:Icon}) => <NavLink key={to} to={to} end={to === "/admin"} className={({isActive}) => "nav-link" + (isActive ? " active" : "")}><Icon size={18}/><span>{label}</span>{to === "/admin/jobs" && <em>3</em>}</NavLink>)}</nav>
    <div className="sidebar-bottom"><NavLink to="/customer" className="nav-link"><LayoutGrid size={18}/><span>بوابة العميل</span><ArrowDownLeft size={14}/></NavLink><NavLink to="/admin/settings" className="nav-link"><Settings size={18}/><span>الإعدادات</span></NavLink><div className="profile"><div className="avatar">ع</div><div><strong>مسؤول المنصة</strong><small>admin@cowboybepob.site</small></div><LogOut size={17}/></div></div>
  </aside>;
}

function Topbar() {
  return <header className="topbar"><div className="crumb"><span>المنصة</span><b>/</b><strong>{pageTitles[useLocation().pathname] || "الإعدادات"}</strong></div><div className="top-actions"><label className="search"><Search size={16}/><input placeholder="ابحث عن أي شيء..." /></label><button className="icon-button" aria-label="الإشعارات"><Bell size={18}/><i/></button><div className="top-divider"/><div className="top-avatar">ع</div><div className="user-label"><b>عبد الرحمن</b><span>مدير النظام</span></div></div></header>;
}

function StatCard({label,value,change,icon:Icon,tone}:{label:string;value:string;change:string;icon:React.ComponentType<{size?:number}>;tone:string}) {
  return <div className="stat-card"><div className={"stat-icon "+tone}><Icon size={20}/></div><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><div className="stat-foot"><span className="trend"><ArrowUpLeft size={13}/>{change}</span><span>مقارنة بالشهر السابق</span></div></div>;
}

function Dashboard() {
  return <><div className="page-heading"><div><div className="eyebrow">ملخص المنصة</div><h1>أهلًا بيك، عبد الرحمن</h1><p>تابع حالة الخدمات والراوترات وأحدث نشاط على منصتك.</p></div><button className="primary-button"><Activity size={16}/> تحديث البيانات</button></div>
    <div className="stat-grid">
      <StatCard label="إجمالي العملاء" value="1,284" change="12.8%" icon={Users} tone="blue"/>
      <StatCard label="الخدمات النشطة" value="2,916" change="8.2%" icon={Wifi} tone="green"/>
      <StatCard label="الراوترات المتصلة" value="86 / 92" change="4.6%" icon={Network} tone="violet"/>
      <StatCard label="إيرادات الشهر" value="48,250 ج.م" change="16.4%" icon={CreditCard} tone="amber"/>
    </div>
    <div className="content-grid"><section className="panel chart-panel"><div className="panel-head"><div><h2>نشاط المنصة</h2><p>نظرة عامة على الطلبات والخدمات خلال آخر 7 أيام</p></div><select defaultValue="7"><option value="7">آخر 7 أيام</option><option value="30">آخر 30 يومًا</option></select></div><div className="chart-legend"><span><i className="legend-blue"/> الطلبات</span><span><i className="legend-green"/> الخدمات المفعّلة</span></div><div className="chart"><div className="y-labels"><span>120</span><span>90</span><span>60</span><span>30</span><span>0</span></div><div className="chart-draw"><div className="grid-lines"><i/><i/><i/><i/><i/></div><svg viewBox="0 0 700 220" preserveAspectRatio="none" role="img" aria-label="رسم توضيحي لنشاط المنصة"><defs><linearGradient id="blueFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#4778eb" stopOpacity=".22"/><stop offset="100%" stopColor="#4778eb" stopOpacity="0"/></linearGradient></defs><path d="M0 170 C30 160 45 130 85 146 S140 162 175 113 S220 128 260 100 S300 125 345 87 S400 106 435 68 S490 94 525 56 S575 72 610 39 S670 50 700 18 L700 220 L0 220 Z" fill="url(#blueFill)"/><path d="M0 170 C30 160 45 130 85 146 S140 162 175 113 S220 128 260 100 S300 125 345 87 S400 106 435 68 S490 94 525 56 S575 72 610 39 S670 50 700 18" fill="none" stroke="#4778eb" strokeWidth="3" vectorEffect="non-scaling-stroke"/><path d="M0 190 C35 182 56 171 85 180 S136 159 175 170 S220 150 260 165 S305 148 345 151 S400 140 435 150 S492 132 525 143 S580 119 610 130 S670 112 700 120" fill="none" stroke="#27b78a" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/></svg><div className="x-labels"><span>الجمعة</span><span>السبت</span><span>الأحد</span><span>الإثنين</span><span>الثلاثاء</span><span>الأربعاء</span><span>الخميس</span></div></div></div></section>
    <section className="panel status-panel"><div className="panel-head"><div><h2>حالة البنية التحتية</h2><p>الحالة الحالية للمكونات</p></div><button className="text-button">التفاصيل <ArrowDownLeft size={14}/></button></div><div className="health-score"><div className="ring"><div><strong>94%</strong><span>الصحة العامة</span></div></div><div className="health-copy"><b>كل شيء يعمل بشكل جيد</b><span>لا توجد أعطال حرجة حاليًا.</span></div></div><div className="health-list"><div><span><i className="status-dot good"/>خوادم API</span><b>3 / 3</b></div><div><span><i className="status-dot good"/>قاعدة البيانات</span><b>متصلة</b></div><div><span><i className="status-dot warn"/>الراوترات</span><b>86 / 92</b></div><div><span><i className="status-dot good"/>طابور المهام</span><b>يعمل</b></div></div></section></div>
    <section className="panel activity-panel"><div className="panel-head"><div><h2>أحدث النشاطات</h2><p>آخر التغييرات المسجلة على المنصة</p></div><NavLink to="/admin/audit" className="text-button">عرض الكل <ArrowDownLeft size={14}/></NavLink></div><div className="table-wrap"><table><thead><tr><th>النشاط</th><th>المستخدم</th><th>التاريخ</th><th>الحالة</th></tr></thead><tbody><tr><td><div className="activity-cell"><span className="activity-icon green"><Users size={16}/></span><div><b>عميل جديد</b><small>تم إنشاء حساب جديد</small></div></div></td><td>أحمد محمد</td><td>منذ 4 دقائق</td><td><span className="pill success">مكتمل</span></td></tr><tr><td><div className="activity-cell"><span className="activity-icon blue"><Wifi size={16}/></span><div><b>تفعيل خدمة</b><small>تم تفعيل باقة منزلية</small></div></div></td><td>نظام التشغيل</td><td>منذ 16 دقيقة</td><td><span className="pill success">مكتمل</span></td></tr><tr><td><div className="activity-cell"><span className="activity-icon amber"><CreditCard size={16}/></span><div><b>دفعة قيد المراجعة</b><small>طلب ORD-2040</small></div></div></td><td>سارة حسن</td><td>منذ 32 دقيقة</td><td><span className="pill pending">مراجعة</span></td></tr></tbody></table></div></section>
    <div className="demo-note"><CircleHelp size={16}/><span>البيانات المعروضة تجريبية لتجهيز الواجهة، وليست بيانات تشغيل حقيقية.</span></div>
  </>;
}

function DataPage({path}:{path:string}) {
  const title = pageTitles[path] || "العناصر";
  const rows = sampleRows[path];
  const headers = columnHeaders[path];
  return <><div className="page-heading"><div><div className="eyebrow">إدارة المنصة</div><h1>{title}</h1><p>عرض ومتابعة وإدارة {title.toLowerCase()} من مكان واحد.</p></div><button className="primary-button"><span>＋</span> إضافة جديد</button></div><div className="metric-strip"><div><span>إجمالي السجلات</span><strong>{path === "/admin/routers" ? "92" : path === "/admin/customers" ? "1,284" : "248"}</strong></div><div><span>نشطة / مكتملة</span><strong className="green-text">86</strong></div><div><span>تحتاج مراجعة</span><strong className="amber-text">6</strong></div></div><section className="panel data-panel"><div className="table-toolbar"><label className="search"><Search size={16}/><input placeholder={"ابحث في "+title+"..."} /></label><button className="outline-button">كل الحالات⌄</button><button className="outline-button">تصدير <ArrowUpLeft size={14}/></button></div><div className="table-wrap"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}<th>إجراءات</th></tr></thead><tbody>{rows.map((row,i)=><tr key={row[0]}>{row.map((cell,j)=><td key={j}>{j === row.length-2 || j === row.length-1 ? <span className={"pill "+( /نشط|مفعّلة|متصل|سليم|منشورة|مكتمل|اكتملت|مقبول/.test(cell)?"success":/معلّق|تحذير|مراجعة|قيد التنفيذ|مسودة|بانتظار/.test(cell)?"pending":"neutral")}>{cell}</span>:cell}</td>)}<td><button className="row-menu" aria-label="خيارات">•••</button></td></tr>)}</tbody></table></div><div className="table-footer"><span>عرض {rows.length} من {path === "/admin/customers" ? "1,284" : "248"} سجلًا (بيانات تجريبية)</span><div><button disabled>السابق</button><button className="page-number">1</button><button>2</button><button>التالي</button></div></div></section></>;
}

function CustomerPortal() {
  return <><div className="page-heading"><div><div className="eyebrow">حساب العميل</div><h1>أهلًا بيك في بوابتك</h1><p>تابع اشتراكاتك وأجهزتك وحالة خدماتك.</p></div></div><div className="stat-grid three"><StatCard label="خدماتي النشطة" value="2" change="خدمة" icon={Wifi} tone="green"/><StatCard label="الأجهزة المرتبطة" value="1" change="راوتر" icon={Network} tone="blue"/><StatCard label="موعد التجديد" value="12 نوفمبر" change="متبقي 27 يومًا" icon={Activity} tone="violet"/></div><section className="panel"><div className="panel-head"><div><h2>الخدمات الحالية</h2><p>ملخص تجريبي لخدمات الحساب</p></div><button className="primary-button">استعراض الباقات</button></div><div className="service-card"><span className="service-symbol"><Wifi size={21}/></span><div className="service-details"><b>الباقة المنزلية</b><span>VLESS · تنتهي 12 نوفمبر 2026</span><div className="usage"><span style={{width:"64%"}}/></div><small>استهلاك البيانات التجريبي: 64% من الحصة الشهرية</small></div><span className="pill success">مفعّلة</span></div></section><div className="demo-note"><CircleHelp size={16}/><span>هذه بوابة واجهة أولية؛ تسجيل الدخول والبيانات الفعلية لم يتم ربطهما بعد.</span></div></>;
}

function App() {
  const location = useLocation();
  const isCustomer = location.pathname.startsWith("/customer");
  const path = location.pathname;
  const activePath = path === "/admin/settings" ? "/admin" : path;
  return <div className="app-shell"><Sidebar/><main className="main-area"><Topbar/><div className="page-content"><Routes><Route path="/admin" element={<Dashboard/>}/><Route path="/admin/customers" element={<DataPage path="/admin/customers"/>}/><Route path="/admin/services" element={<DataPage path="/admin/services"/>}/><Route path="/admin/routers" element={<DataPage path="/admin/routers"/>}/><Route path="/admin/servers" element={<DataPage path="/admin/servers"/>}/><Route path="/admin/catalog" element={<DataPage path="/admin/catalog"/>}/><Route path="/admin/orders" element={<DataPage path="/admin/orders"/>}/><Route path="/admin/payments" element={<DataPage path="/admin/payments"/>}/><Route path="/admin/jobs" element={<DataPage path="/admin/jobs"/>}/><Route path="/admin/audit" element={<DataPage path="/admin/audit"/>}/><Route path="/customer" element={<CustomerPortal/>}/><Route path="/customer/services" element={<CustomerPortal/>}/><Route path="/customer/routers" element={<CustomerPortal/>}/><Route path="/admin/settings" element={<div className="empty-state"><Settings size={28}/><h1>الإعدادات</h1><p>سيتم تنفيذ إعدادات الحساب والصلاحيات في مرحلة المصادقة.</p></div>}/><Route path="*" element={<Dashboard/>}/></Routes></div><footer className="footer"><span>© 2026 CowboyBepob Platform</span><span>الإصدار 0.1.0 · واجهة أولية</span></footer></main></div>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><BrowserRouter><App/></BrowserRouter></React.StrictMode>);
