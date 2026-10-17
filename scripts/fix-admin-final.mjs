import fs from 'node:fs';

const apiPath='apps/api/src/main.ts';
const webPath='apps/web/src/main.tsx';

// ---------- API ----------
let api=fs.readFileSync(apiPath,'utf8');

// Keep exactly one GET /admin/subscriptions route.
const subRe=/\n  admin\.get('\/subscriptions', async \(req:any\) => \{[\s\S]*?\n  \}\);/g;
const subMatches=api.match(subRe)||[];
if(subMatches.length>1){
  let seen=0;
  api=api.replace(subRe,m=>++seen===1?m:'');
  console.log(`API: removed ${subMatches.length-1} duplicate subscription route(s)`);
}

// Dedicated endpoint for the router-registration modal.
if(!api.includes("admin.get('/customers/:customerId/configs'")){
  const customerRe=/  admin\.get('\/customers', async \(req:any\) => \{[\s\S]*?\n  \}\);/;
  const m=api.match(customerRe);
  if(!m) throw new Error('API: customers GET route not found');
  const route="\n  admin.get('/customers/:customerId/configs', async (req:any) => { requirePermission(req,'services:read'); return (await db(`SELECT cfg.id config_id,cfg.public_code config_code,s.id service_id,s.public_code service_code,s.status service_status,c.name category,c.protocol FROM configs cfg JOIN services s ON s.id=cfg.service_id JOIN customers cu ON cu.id=s.customer_id JOIN config_categories c ON c.id=s.category_id WHERE cu.id=$1 AND cu.status<>'DELETED' AND cfg.status='CURRENT' AND s.status IN ('PROVISIONING','ACTIVE','SUSPENDED') ORDER BY cfg.created_at DESC`,[req.params.customerId])).rows; });";
  api=api.replace(m[0],m[0]+route);
  console.log('API: added customer configs endpoint');
}

// Hard-delete configs, including CURRENT configs. The service remains; only the config row is removed.
const guard=" if(cfg.rows[0].config_status==='CURRENT' && ['PROVISIONING','ACTIVE','SUSPENDED'].includes(cfg.rows[0].service_status)) throw Object.assign(new Error('لا يمكن حذف الكونفيج الحالي لخدمة نشطة. أنهِ الخدمة أولًا.'),{statusCode:409});";
if(api.includes(guard)){
  api=api.replace(guard,'');
  console.log('API: removed active-config delete restriction');
}

if(!api.includes("admin.delete('/configs/:id'")) throw new Error('API: config DELETE route missing');
if(!api.includes("admin.delete('/subscriptions/:id'")) throw new Error('API: subscription DELETE route missing');
if(!api.includes("admin.post('/routers'")) throw new Error('API: router registration route missing');

fs.writeFileSync(apiPath,api);

// ---------- Web ----------
let web=fs.readFileSync(webPath,'utf8');
const routerRe=/function RouterForm\(\{onClose,onDone\}:\{onClose:\(\)=>void;onDone:\(\)=>void\}\)\{[\s\S]*?\nfunction ServerForm/;
const routerMatch=web.match(routerRe);
if(!routerMatch) throw new Error('WEB: RouterForm not found');

const routerFn="function RouterForm({onClose,onDone}:{onClose:()=>void;onDone:()=>void}){const [v,setV]=useState<any>({});const [customers,setCustomers]=useState<any[]>([]);const [configs,setConfigs]=useState<any[]>([]);const [error,setError]=useState('');const [saving,setSaving]=useState(false);const [loadingConfigs,setLoadingConfigs]=useState(false);useEffect(()=>{void api('/api/v1/admin/customers').then(setCustomers).catch(e=>setError(e.message))},[]);useEffect(()=>{if(!v.customerId){setConfigs([]);return}setLoadingConfigs(true);setError('');void api('/api/v1/admin/customers/'+encodeURIComponent(v.customerId)+'/configs').then((x:any[])=>setConfigs(Array.isArray(x)?x:[])).catch(e=>setError(e.message)).finally(()=>setLoadingConfigs(false))},[v.customerId]);const save=async(e:FormEvent)=>{e.preventDefault();setSaving(true);setError('');try{await api('/api/v1/admin/routers',{method:'POST',body:JSON.stringify(v)});onDone()}catch(e:any){setError(e.message)}finally{setSaving(false)}};return <Modal title=\"تسجيل راوتر وربطه بكونفيج\" onClose={onClose}><form onSubmit={save}><Field label=\"Serial Number\" value={v.serialNumber||''} onChange={x=>setV({...v,serialNumber:x})}/><Field label=\"Device ID\" value={v.deviceIdentifier||''} onChange={x=>setV({...v,deviceIdentifier:x})}/><Field label=\"Model\" value={v.model||''} onChange={x=>setV({...v,model:x})}/><Field label=\"Firmware\" value={v.openwrtVersion||''} onChange={x=>setV({...v,openwrtVersion:x})}/><label>العميل<select value={v.customerId||''} onChange={e=>setV({...v,customerId:e.target.value,configId:''})} required><option value=\"\">اختر العميل</option>{customers.map(c=><option key={c.id} value={c.id}>{c.full_name} · {c.public_code}</option>)}</select></label><label>الكونفيج المرتبط<select value={v.configId||''} onChange={e=>setV({...v,configId:e.target.value})} required disabled={!v.customerId||loadingConfigs}><option value=\"\">{loadingConfigs?'جاري تحميل الكونفيجات...':'اختر الكونفيج'}</option>{configs.map(cfg=><option key={cfg.config_id} value={cfg.config_id}>{cfg.config_code} · {cfg.service_code} · {cfg.category} · {cfg.protocol}</option>)}</select></label>{v.customerId&&!loadingConfigs&&!configs.length&&<div className=\"alert\">لا توجد كونفيجات حالية قابلة للربط لهذا العميل.</div>}{error&&<div className=\"alert error\">{error}</div>}<button className=\"primary-button full\" disabled={saving||loadingConfigs||!v.customerId||!v.configId}>{saving?'جاري الحفظ...':'حفظ الراوتر'}</button></form></Modal>}
function ServerForm";

web=web.replace(routerMatch[0],routerFn);
if(!web.includes("api('/api/v1/admin/customers/'+encodeURIComponent(v.customerId)+'/configs')")) throw new Error('WEB: router config endpoint not applied');
if(!web.includes("function ConfigsPage()")) throw new Error('WEB: configs page missing');
if(!web.includes("/admin/subscriptions")) throw new Error('WEB: subscriptions page/route missing');

fs.writeFileSync(webPath,web);
console.log('WEB: RouterForm now loads configs directly for the selected customer');
console.log('Admin fixes applied successfully.');
