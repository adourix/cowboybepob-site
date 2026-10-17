import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const webFiles = [
  path.join(root, 'apps/web/src/app.tsx'),
  path.join(root, 'apps/web/src/main.tsx'),
];

function replaceRequired(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Missing marker: ${label}`);
  return next;
}

for (const file of webFiles) {
  let s = fs.readFileSync(file, 'utf8');

  // The agreed UI: Services is the primary page. Subscriptions are shown as
  // service details, not as a second competing top-level resource.
  s = s.replace("['/admin/subscriptions','الاشتراكات',CreditCard],", '');
  s = s.replace("['/admin/configs','الكونفيجات',Box],", '');
  s = s.replace("Activity,Box,CreditCard", "Activity,CreditCard");
  s = s.replace("Activity,CreditCard,ExternalLink", "Activity,CreditCard,ExternalLink");

  s = s.replace(
    /type ResourceKind='customers'\|'services'\|'subscriptions'\|'routers'\|'servers'\|'orders'\|'payments'\|'jobs'\|'audit';/,
    "type ResourceKind='customers'|'services'|'routers'|'servers'|'orders'|'payments'|'jobs'|'audit';"
  );

  s = replaceRequired(
    s,
    /services:\{title:'الخدمات',endpoint:'\/api\/v1\/admin\/services',cols:\[[^\]]*\],keys:\[[^\]]*\]\},/,
    "services:{title:'الخدمات',endpoint:'/api/v1/admin/services',cols:['الخدمة','العميل','الفئة','الكونفيج','الراوتر','الاشتراك','الاشتراك','الاستخدام','الانتهاء','الحالة'],keys:['public_code','customer_name','category','config_code','router_code','subscription_code','subscription_status','usage_display','current_period_end','status']},",
    'services metadata'
  );

  // Remove the standalone subscriptions metadata block when present.
  s = s.replace(
    /\n subscriptions:\{title:'الاشتراكات',[\s\S]*?\},\n routers:/,
    "\n routers:"
  );

  // Render quota usage from the service's embedded subscription.
  if (!s.includes("const bytes=(v:any)=>")) {
    const dateMarker = "const date=(v:any)=>v?new Date(v).toLocaleString('ar-EG',{dateStyle:'medium',timeStyle:'short'}):'—';";
    if (s.includes(dateMarker)) {
      s = s.replace(dateMarker, dateMarker + "\nconst bytes=(v:any)=>{const n=Number(v);if(!Number.isFinite(n)||n<0)return '—';if(n>=1024**3)return `${(n/1024**3).toFixed(1)} GB`;if(n>=1024**2)return `${(n/1024**2).toFixed(1)} MB`;if(n>=1024)return `${(n/1024).toFixed(1)} KB`;return `${n} B`;};");
    }
  }

  s = s.replace(
    "k.includes('minor')?money(r[k]):k.endsWith('_at')||k.includes('date')?date(r[k]):['status','connectivity','state','lifecycle_status','health_status'].includes(k)?<span className=\"badge\">{label(r[k])}</span>:String(r[k]??'—')",
    "k==='usage_display'?`${bytes(r.used_bytes)} / ${bytes(r.quota_bytes)}`:k.includes('minor')?money(r[k]):k.endsWith('_at')||k.includes('date')?date(r[k]):['status','subscription_status','connectivity','state','lifecycle_status','health_status'].includes(k)?<span className=\"badge\">{label(r[k])}</span>:String(r[k]??'—')"
  );

  // Make the page clearly explain that subscription is part of the service.
  s = s.replace(
    "<Heading title={m.title} sub={kind==='payments'?'مراجعة وتأكيد المدفوعات اليدوية من هنا.':'بيانات حقيقية من الـAPI.'}",
    "<Heading title={m.title} sub={kind==='services'?'الخدمة هي الكيان الأساسي، والاشتراك والكونفيج يظهران بداخلها.':kind==='payments'?'مراجعة وتأكيد المدفوعات اليدوية من هنا.':'بيانات حقيقية من الـAPI.'}"
  );

  // Keep old direct URLs working, but redirect them into the unified Services page.
  s = s.replace(
    /<Route path="\/admin\/subscriptions" element=\{[^}]*\}\/>/,
    '<Route path="/admin/subscriptions" element={<Navigate to="/admin/services" replace/>}/>'
  );
  s = s.replace(
    /<Route path="\/admin\/configs" element=\{[^}]*\}\/>/,
    '<Route path="/admin/configs" element={<Navigate to="/admin/services" replace/>}/>'
  );

  // Import Navigate if redirects were inserted.
  if (s.includes('Navigate to="/admin/services"') && !s.includes(',Navigate}')) {
    s = s.replace(
      "import {BrowserRouter,useNavigate,useLocation,NavLink,Routes,Route} from 'react-router-dom';",
      "import {BrowserRouter,useNavigate,useLocation,NavLink,Routes,Route,Navigate} from 'react-router-dom';"
    );
  }

  fs.writeFileSync(file, s);
  console.log(`Updated ${path.relative(root,file)}`);
}

console.log('Subscriptions are restored as embedded service details; standalone subscription/config navigation is hidden.');
