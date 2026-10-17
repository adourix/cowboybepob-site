import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [
  path.join(root, 'apps/web/src/app.tsx'),
  path.join(root, 'apps/web/src/main.tsx'),
];

function replaceOnce(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Missing marker: ${label}`);
  return next;
}

for (const file of files) {
  let s = fs.readFileSync(file, 'utf8');

  // Keep Services as the primary business UI. Subscriptions and configs remain
  // database/API concepts, but are no longer separate admin navigation pages.
  s = s.replace("['/admin/subscriptions','الاشتراكات',CreditCard],", '');
  s = s.replace("['/admin/configs','الكونفيجات',Box],", '');
  s = s.replace("Activity,Box,CreditCard", "Activity,CreditCard");

  s = replaceOnce(
    s,
    /type ResourceKind='customers'\|'services'\|'subscriptions'\|'routers'\|'servers'\|'orders'\|'payments'\|'jobs'\|'audit';/,
    "type ResourceKind='customers'|'services'|'routers'|'servers'|'orders'|'payments'|'jobs'|'audit';",
    'ResourceKind'
  );

  s = replaceOnce(
    s,
    /services:\{title:'الخدمات',endpoint:'\/api\/v1\/admin\/services',cols:\[[^\]]+\],keys:\[[^\]]+\]\},\n subscriptions:\{title:'الاشتراكات',[\s\S]*?\},\n routers:/,
    "services:{title:'الخدمات',endpoint:'/api/v1/admin/services',cols:['الكود','العميل','الفئة','البروتوكول','الحالة','الاشتراك','الاستخدام','الانتهاء','الكونفيج','الراوتر'],keys:['public_code','customer_name','category','protocol','status','subscription_status','usage_display','current_period_end','config_code','router_code']},\n routers:",
    'services/subscriptions meta'
  );

  // Add a display-only usage field without changing the API contract.
  if (!s.includes("const bytes=(v:any)=>")) {
    s = replaceOnce(
      s,
      "const date=(v:any)=>v?new Date(v).toLocaleString('ar-EG',{dateStyle:'medium',timeStyle:'short'}):'—';",
      "const date=(v:any)=>v?new Date(v).toLocaleString('ar-EG',{dateStyle:'medium',timeStyle:'short'}):'—';\nconst bytes=(v:any)=>{const n=Number(v);if(!Number.isFinite(n)||n<0)return '—';if(n>=1024**3)return `${(n/1024**3).toFixed(1)} GB`;if(n>=1024**2)return `${(n/1024**2).toFixed(1)} MB`;if(n>=1024)return `${(n/1024).toFixed(1)} KB`;return `${n} B`;};",
      'bytes helper'
    );
  }

  s = s.replace(
    "const canAdd=['customers','routers','servers'].includes(kind);",
    "const canAdd=['customers','services','routers','servers'].includes(kind);"
  );
  s = s.replace(
    "<Heading title={m.title} sub={kind==='payments'?'مراجعة وتأكيد المدفوعات اليدوية من هنا.':'بيانات حقيقية من الـAPI.'} onAdd={canAdd?()=>setOpen(true):undefined}/>",
    "<Heading title={m.title} sub={kind==='services'?'الخدمة هي الكيان الأساسي؛ الاشتراك والكونفيج يظهران بداخلها.':kind==='payments'?'مراجعة وتأكيد المدفوعات اليدوية من هنا.':'بيانات حقيقية من الـAPI.'} onAdd={canAdd?()=>setOpen(true):undefined} addText={kind==='services'?'إضافة خدمة':undefined}/>"
  );

  // Remove subscription-specific delete/UI branches. Service deletion already
  // removes its subscription periods, configs and provider account in the API.
  s = s.replace("const title=kind==='routers'?'الراوتر':kind==='subscriptions'?'الاشتراك':kind==='services'?'الخدمة':'الخادم';", "const title=kind==='routers'?'الراوتر':kind==='services'?'الخدمة':'الخادم';");
  s = s.replace(":kind==='subscriptions'?`/api/v1/admin/subscriptions/${id}`", '');
  s = s.replace("['services','subscriptions','routers','servers','payments']", "['services','routers','servers','payments']");
  s = s.replace("['services','subscriptions','routers'].includes(kind)", "['services','routers'].includes(kind)");

  // Render bytes for the service usage column.
  s = s.replace(
    "k.includes('minor')?money(r[k]):k.endsWith('_at')||k.includes('date')?date(r[k]):['status','connectivity','state','lifecycle_status','health_status'].includes(k)?<span className=\"badge\">{label(r[k])}</span>:String(r[k]??'—')",
    "k==='usage_display'?`${bytes(r.used_bytes)} / ${bytes(r.quota_bytes)}`:k.includes('minor')?money(r[k]):k.endsWith('_at')||k.includes('date')?date(r[k]):['status','subscription_status','connectivity','state','lifecycle_status','health_status'].includes(k)?<span className=\"badge\">{label(r[k])}</span>:String(r[k]??'—')"
  );

  // Service creation: customer + plan/category + manual VLESS/VMess link.
  if (!s.includes('function ServiceForm(')) {
    const anchor = 'function CustomerForm({onClose,onDone}';
    const idx = s.indexOf(anchor);
    if (idx < 0) throw new Error('ServiceForm insertion marker missing');
    const serviceForm = `function ServiceForm({onClose,onDone}:{onClose:()=>void;onDone:()=>void}){const [customers,setCustomers]=useState<any[]>([]);const [cats,setCats]=useState<any[]>([]);const [plans,setPlans]=useState<any[]>([]);const [v,setV]=useState<any>({});const [error,setError]=useState('');const [saving,setSaving]=useState(false);useEffect(()=>{void api('/api/v1/admin/customers').then(setCustomers).catch(e=>setError(e.message));void api('/api/v1/admin/catalog').then((x:any)=>{setCats(x.categories||[]);setPlans(x.plans||[])}).catch(e=>setError(e.message))},[]);const save=async(e:FormEvent)=>{e.preventDefault();setSaving(true);setError('');try{if(!v.customerId||!v.link)throw new Error('العميل ورابط VLESS/VMess مطلوبان');if(!v.planId&&!v.categoryId)throw new Error('اختر باقة أو فئة للخدمة');await api('/api/v1/admin/services/manual',{method:'POST',body:JSON.stringify({customerId:v.customerId,planId:v.planId||null,categoryId:v.planId?null:v.categoryId,link:v.link,routerId:v.routerId||null})});onDone()}catch(e:any){setError(e.message)}finally{setSaving(false)}};return <Modal title="إضافة خدمة / كونفيج يدوي" onClose={onClose}><form onSubmit={save}><label>العميل<select value={v.customerId||''} onChange={e=>setV({...v,customerId:e.target.value})} required><option value="">اختر العميل</option>{customers.map(c=><option key={c.id} value={c.id}>{c.full_name} · {c.public_code}</option>)}</select></label><label>الباقة الحالية<select value={v.planId||''} onChange={e=>setV({...v,planId:e.target.value,categoryId:''})}><option value="">بدون اشتراك — اختر فئة بالأسفل</option>{plans.filter((p:any)=>p.status==='ACTIVE').map((p:any)=><option key={p.id} value={p.id}>{p.name} · {p.category_name} · {money(p.price_minor)}</option>)}</select></label>{!v.planId&&<label>الفئة<select value={v.categoryId||''} onChange={e=>setV({...v,categoryId:e.target.value})} required={!v.planId}><option value="">اختر الفئة</option>{cats.filter((c:any)=>c.status==='ACTIVE').map((c:any)=><option key={c.id} value={c.id}>{c.name} · {c.protocol}</option>)}</select></label>}<Field label="رابط VLESS / VMess" value={v.link||''} onChange={x=>setV({...v,link:x})} placeholder="vless://... أو vmess://..."/><p className="form-hint">الخدمة هي الكيان الأساسي. عند اختيار باقة سيُنشأ الاشتراك معها، والكونفيج يصبح الكونفيج الحالي للخدمة.</p>{error&&<div className="alert error">{error}</div>}<button className="primary-button full" disabled={saving}>{saving?'جاري الإنشاء...':'إنشاء الخدمة'}</button></form></Modal>}\n`;
    s = s.slice(0, idx) + serviceForm + s.slice(idx);
  }

  s = s.replace(
    "{open&&kind==='customers'&&<CustomerForm onClose={()=>setOpen(false)} onDone={()=>{setOpen(false);load()}}/>}",
    "{open&&kind==='customers'&&<CustomerForm onClose={()=>setOpen(false)} onDone={()=>{setOpen(false);load()}}/>}{open&&kind==='services'&&<ServiceForm onClose={()=>setOpen(false)} onDone={()=>{setOpen(false);load()}}/>}"
  );

  // Config is an implementation detail of Service, not an admin page.
  const cfgStart = s.indexOf('function ConfigsPage(');
  if (cfgStart >= 0) {
    const cfgEnd = s.indexOf('\nfunction SettingsPage(', cfgStart);
    if (cfgEnd < 0) throw new Error('ConfigsPage end marker missing');
    s = s.slice(0, cfgStart) + s.slice(cfgEnd + 1);
  }
  s = s.replace("<Route path=\"/admin/subscriptions\" element={<ResourcePage kind=\"subscriptions\" user={user}/>}/>", "<Route path=\"/admin/subscriptions\" element={<Navigate to=\"/admin/services\" replace/>}/>");
  s = s.replace("<Route path=\"/admin/configs\" element={<ConfigsPage/>}/>", "<Route path=\"/admin/configs\" element={<Navigate to=\"/admin/services\" replace/>}/>");

  fs.writeFileSync(file, s);
  console.log(`Updated ${path.relative(root,file)}`);
}

console.log('Services are now the primary admin entity; subscription/config are embedded details.');
`