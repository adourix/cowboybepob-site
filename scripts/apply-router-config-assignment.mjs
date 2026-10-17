import fs from 'node:fs';

const api = 'apps/api/src/main.ts';
const web = 'apps/web/src/main.tsx';

function read(path){return fs.readFileSync(path,'utf8');}
function write(path,value){fs.writeFileSync(path,value);}
function replaceOnce(text, from, to, label){
  if(!text.includes(from)) throw new Error(`Patch target not found: ${label}`);
  return text.replace(from,to);
}

let a=read(api);

const adminServicesOld="SELECT s.id,s.public_code,s.label,s.status,s.provisioning_mode,s.created_at,c.name category,c.protocol,sub.status subscription_status,sub.current_period_end,sub.starts_at,sub.used_bytes,sub.quota_bytes,cu.public_code customer_code,cu.full_name customer_name,r.public_code router_code,h.city,h.country,se.public_code endpoint_code FROM services s JOIN customers cu ON cu.id=s.customer_id JOIN config_categories c ON c.id=s.category_id LEFT JOIN subscriptions sub ON sub.service_id=s.id LEFT JOIN routers r ON r.id=s.router_id LEFT JOIN service_allocations sa ON sa.service_id=s.id AND sa.status='ACTIVE' LEFT JOIN server_endpoints se ON se.id=sa.endpoint_id LEFT JOIN hosts h ON h.id=se.host_id ORDER BY s.created_at DESC LIMIT 200";
const adminServicesNew="SELECT s.id,s.public_code,s.label,s.status,s.provisioning_mode,s.created_at,c.name category,c.protocol,sub.status subscription_status,sub.current_period_end,sub.starts_at,sub.used_bytes,sub.quota_bytes,cu.public_code customer_code,cu.full_name customer_name,r.public_code router_code,cfg.public_code config_code,h.city,h.country,se.public_code endpoint_code FROM services s JOIN customers cu ON cu.id=s.customer_id JOIN config_categories c ON c.id=s.category_id LEFT JOIN subscriptions sub ON sub.service_id=s.id LEFT JOIN routers r ON r.id=s.router_id LEFT JOIN configs cfg ON cfg.service_id=s.id AND cfg.status='CURRENT' LEFT JOIN service_allocations sa ON sa.service_id=s.id AND sa.status='ACTIVE' LEFT JOIN server_endpoints se ON se.id=sa.endpoint_id LEFT JOIN hosts h ON h.id=se.host_id ORDER BY s.created_at DESC LIMIT 200";
a=replaceOnce(a,adminServicesOld,adminServicesNew,'admin services config code');

const customerServicesOld="SELECT s.id,s.public_code,s.label,c.name category_name,s.status,sub.status subscription_status,sub.starts_at,sub.current_period_end,sub.used_bytes,sub.quota_bytes,r.public_code router_code,r.model router_model,r.connectivity router_connectivity,h.city,h.country FROM services s JOIN config_categories c ON c.id=s.category_id LEFT JOIN subscriptions sub ON sub.service_id=s.id LEFT JOIN routers r ON r.id=s.router_id LEFT JOIN service_allocations a ON a.service_id=s.id AND a.status='ACTIVE' LEFT JOIN server_endpoints e ON e.id=a.endpoint_id LEFT JOIN hosts h ON h.id=e.host_id WHERE s.customer_id=$1 ORDER BY s.created_at DESC";
const customerServicesNew="SELECT s.id,s.public_code,s.label,c.name category_name,s.status,sub.status subscription_status,sub.starts_at,sub.current_period_end,sub.used_bytes,sub.quota_bytes,r.public_code router_code,r.model router_model,r.connectivity router_connectivity,cfg.public_code config_code,h.city,h.country FROM services s JOIN config_categories c ON c.id=s.category_id LEFT JOIN subscriptions sub ON sub.service_id=s.id LEFT JOIN routers r ON r.id=s.router_id LEFT JOIN configs cfg ON cfg.service_id=s.id AND cfg.status='CURRENT' LEFT JOIN service_allocations a ON a.service_id=s.id AND a.status='ACTIVE' LEFT JOIN server_endpoints e ON e.id=a.endpoint_id LEFT JOIN hosts h ON h.id=e.host_id WHERE s.customer_id=$1 ORDER BY s.created_at DESC";
a=replaceOnce(a,customerServicesOld,customerServicesNew,'customer services config code');

const customerServiceOneOld="SELECT s.id,s.public_code,s.label,c.name category_name,s.status,sub.status subscription_status,sub.starts_at,sub.current_period_end,sub.used_bytes,sub.quota_bytes,r.public_code router_code,r.model router_model,r.connectivity router_connectivity,h.city,h.country FROM services s JOIN config_categories c ON c.id=s.category_id LEFT JOIN subscriptions sub ON sub.service_id=s.id LEFT JOIN routers r ON r.id=s.router_id LEFT JOIN service_allocations a ON a.service_id=s.id AND a.status='ACTIVE' LEFT JOIN server_endpoints e ON e.id=a.endpoint_id LEFT JOIN hosts h ON h.id=e.host_id WHERE s.id=$1 AND s.customer_id=$2";
const customerServiceOneNew="SELECT s.id,s.public_code,s.label,c.name category_name,s.status,sub.status subscription_status,sub.starts_at,sub.current_period_end,sub.used_bytes,sub.quota_bytes,r.public_code router_code,r.model router_model,r.connectivity router_connectivity,cfg.public_code config_code,h.city,h.country FROM services s JOIN config_categories c ON c.id=s.category_id LEFT JOIN subscriptions sub ON sub.service_id=s.id LEFT JOIN routers r ON r.id=s.router_id LEFT JOIN configs cfg ON cfg.service_id=s.id AND cfg.status='CURRENT' LEFT JOIN service_allocations a ON a.service_id=s.id AND a.status='ACTIVE' LEFT JOIN server_endpoints e ON e.id=a.endpoint_id LEFT JOIN hosts h ON h.id=e.host_id WHERE s.id=$1 AND s.customer_id=$2";
a=replaceOnce(a,customerServiceOneOld,customerServiceOneNew,'customer service detail config code');

const customerRoutersOld="SELECT r.public_code,r.model,r.firmware_version,r.connectivity,r.lifecycle_status,r.last_seen_at,r.notes,(SELECT s.public_code FROM services s WHERE s.router_id=r.id AND s.status IN ('PROVISIONING','ACTIVE','SUSPENDED') LIMIT 1) assigned_service FROM routers r WHERE r.customer_id=$1 ORDER BY r.created_at DESC";
const customerRoutersNew="SELECT r.public_code,r.model,r.firmware_version,r.connectivity,r.lifecycle_status,r.last_seen_at,r.notes,(SELECT s.public_code FROM services s WHERE s.router_id=r.id AND s.status IN ('PROVISIONING','ACTIVE','SUSPENDED') LIMIT 1) assigned_service,(SELECT cfg.public_code FROM services s JOIN configs cfg ON cfg.service_id=s.id AND cfg.status='CURRENT' WHERE s.router_id=r.id AND s.status IN ('PROVISIONING','ACTIVE','SUSPENDED') LIMIT 1) config_code FROM routers r WHERE r.customer_id=$1 ORDER BY r.created_at DESC";
a=replaceOnce(a,customerRoutersOld,customerRoutersNew,'customer router config code');

const adminRoutersOld="SELECT r.*,c.public_code customer_code,c.full_name customer_name FROM routers r LEFT JOIN customers c ON c.id=r.customer_id ORDER BY r.created_at DESC LIMIT 200";
const adminRoutersNew="SELECT r.*,c.public_code customer_code,c.full_name customer_name,(SELECT s.public_code FROM services s WHERE s.router_id=r.id AND s.status IN ('PROVISIONING','ACTIVE','SUSPENDED') LIMIT 1) service_code,(SELECT cfg.public_code FROM services s JOIN configs cfg ON cfg.service_id=s.id AND cfg.status='CURRENT' WHERE s.router_id=r.id AND s.status IN ('PROVISIONING','ACTIVE','SUSPENDED') LIMIT 1) config_code FROM routers r LEFT JOIN customers c ON c.id=r.customer_id ORDER BY r.created_at DESC LIMIT 200";
a=replaceOnce(a,adminRoutersOld,adminRoutersNew,'admin router assignment fields');

const routerPostOld="admin.post('/routers', async (req:any) => { requirePermission(req,'routers:write');requireCsrf(req);const b=req.body||{};return (await db(`INSERT INTO routers(serial_number,device_identifier,model,hardware_revision,openwrt_version,firmware_version,customer_id,lifecycle_status) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7 IS NULL THEN 'IN_STOCK' ELSE 'ASSIGNED' END) RETURNING *`,[b.serialNumber,b.deviceIdentifier||null,b.model,b.hardwareRevision||null,b.openwrtVersion||null,b.firmwareVersion||null,b.customerId||null])).rows[0]; });";
const routerPostNew=`admin.post('/routers', async (req:any) => {
    requirePermission(req,'routers:write'); requireCsrf(req);
    const b=req.body||{};
    const customerId=b.customerId?String(b.customerId):null;
    const configId=b.configId?String(b.configId):null;
    if(configId&&!customerId) throw Object.assign(new Error('اختيار الكونفيج يتطلب اختيار العميل'),{statusCode:400});
    const c=await pool.connect();
    try{
      await c.query('BEGIN');
      if(customerId){
        const cr=await c.query(`SELECT id FROM customers WHERE id=$1 AND status<>'DELETED'`,[customerId]);
        if(!cr.rowCount) throw Object.assign(new Error('العميل غير موجود'),{statusCode:404});
      }
      let serviceId=null;
      let configCode=null;
      if(configId){
        const cfg=await c.query(`SELECT cfg.id,cfg.public_code,cfg.service_id,s.customer_id,s.public_code service_code,s.status FROM configs cfg JOIN services s ON s.id=cfg.service_id WHERE cfg.id=$1 AND cfg.status='CURRENT' FOR UPDATE`,[configId]);
        if(!cfg.rowCount) throw Object.assign(new Error('الكونفيج غير موجود أو غير نشط'),{statusCode:404});
        const x=cfg.rows[0];
        if(x.customer_id!==customerId) throw Object.assign(new Error('الكونفيج لا يتبع العميل المختار'),{statusCode:409});
        if(!['PROVISIONING','ACTIVE','SUSPENDED'].includes(x.status)) throw Object.assign(new Error('الخدمة المرتبطة بالكونفيج غير قابلة للربط'),{statusCode:409});
        const live=await c.query(`SELECT id FROM services WHERE router_id IS NOT NULL AND router_id=$1 AND status IN('PROVISIONING','ACTIVE','SUSPENDED')`,[b.routerId||'00000000-0000-0000-0000-000000000000']);
        if(live.rowCount) throw Object.assign(new Error('الكونفيج/الخدمة مرتبطة براوتر آخر'),{statusCode:409});
        serviceId=x.service_id; configCode=x.public_code;
        const already=await c.query(`SELECT id FROM services WHERE router_id IS NOT NULL AND router_id=$1 AND status IN('PROVISIONING','ACTIVE','SUSPENDED')`,[b.routerId||'00000000-0000-0000-0000-000000000000']);
        if(already.rowCount) throw Object.assign(new Error('الراوتر مرتبط بخدمة أخرى بالفعل'),{statusCode:409});
      }
      const router=(await c.query(`INSERT INTO routers(serial_number,device_identifier,model,hardware_revision,openwrt_version,firmware_version,customer_id,lifecycle_status) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7 IS NULL THEN 'IN_STOCK' ELSE 'ASSIGNED' END) RETURNING *`,[b.serialNumber,b.deviceIdentifier||null,b.model,b.hardwareRevision||null,b.openwrtVersion||null,b.firmwareVersion||null,customerId])).rows[0];
      if(serviceId){
        const conflict=await c.query(`SELECT id FROM services WHERE router_id=$1 AND status IN('PROVISIONING','ACTIVE','SUSPENDED')`,[router.id]);
        if(conflict.rowCount) throw Object.assign(new Error('الراوتر مرتبط بخدمة أخرى بالفعل'),{statusCode:409});
        await c.query(`UPDATE services SET router_id=$1,updated_at=now() WHERE id=$2`,[router.id,serviceId]);
      }
      await c.query('COMMIT');
      return {...router,service_id:serviceId,config_code:configCode};
    }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
  });`;
a=replaceOnce(a,routerPostOld,routerPostNew,'router create assignment');

const actionOld="admin.post('/routers/:id/action', async (req:any) => { requirePermission(req,'routers:write');requireCsrf(req);const action=String(req.body?.action||'');const next:any=({assign:'ASSIGNED',provision:'PROVISIONING',ready:'READY',replace:'REPLACED',decommission:'DECOMMISSIONED',unassign:'IN_STOCK'} as Record<string,string>)[action];if(!next)throw Object.assign(new Error('Unsupported action'),{statusCode:400});const r=await db('UPDATE routers SET lifecycle_status=$1,updated_at=now() WHERE id=$2 RETURNING *',[next,req.params.id]);if(!r.rowCount)throw Object.assign(new Error('Not found'),{statusCode:404});return r.rows[0]; });";
const actionNew=`admin.post('/routers/:id/action', async (req:any) => { requirePermission(req,'routers:write');requireCsrf(req);const action=String(req.body?.action||'');const next:any=({assign:'ASSIGNED',provision:'PROVISIONING',ready:'READY',replace:'REPLACED',decommission:'DECOMMISSIONED',unassign:'IN_STOCK'} as Record<string,string>)[action];if(!next)throw Object.assign(new Error('Unsupported action'),{statusCode:400});const r=await db('UPDATE routers SET lifecycle_status=$1,updated_at=now() WHERE id=$2 RETURNING *',[next,req.params.id]);if(!r.rowCount)throw Object.assign(new Error('Not found'),{statusCode:404});if(action==='unassign'){const live=await db("SELECT id FROM services WHERE router_id=$1 AND status IN('PROVISIONING','ACTIVE','SUSPENDED')",[req.params.id]);if(live.rowCount)throw Object.assign(new Error('لا يمكن فك الراوتر قبل فك ارتباط الخدمة'),{statusCode:409});await db("UPDATE routers SET customer_id=NULL WHERE id=$1",[req.params.id]);}return r.rows[0]; });`;
a=replaceOnce(a,actionOld,actionNew,'router action safety');
write(api,a);

let w=read(web);
const metaOld="routers:{title:'الراوترات',endpoint:'/api/v1/admin/routers',cols:['الكود','الموديل','العميل','الدورة','الاتصال','آخر ظهور'],keys:['public_code','model','customer_name','lifecycle_status','connectivity','last_seen_at']},";
const metaNew="routers:{title:'الراوترات',endpoint:'/api/v1/admin/routers',cols:['الكود','الموديل','العميل','الكونفيج','الخدمة','الدورة','الاتصال','آخر ظهور'],keys:['public_code','model','customer_name','config_code','service_code','lifecycle_status','connectivity','last_seen_at']},";
w=replaceOnce(w,metaOld,metaNew,'admin router table columns');

const formOld=`function RouterForm({onClose,onDone}:{onClose:()=>void;onDone:()=>void}){const [v,setV]=useState<any>({});const save=async(e:FormEvent)=>{e.preventDefault();await api('/api/v1/admin/routers',{method:'POST',body:JSON.stringify(v)});onDone()};return <Modal title="إضافة راوتر للمخزون" onClose={onClose}><form onSubmit={save}><Field label="Serial Number" value={v.serialNumber||''} onChange={x=>setV({...v,serialNumber:x})}/><Field label="Device Identifier" value={v.deviceIdentifier||''} onChange={x=>setV({...v,deviceIdentifier:x})}/><Field label="Model" value={v.model||''} onChange={x=>setV({...v,model:x})}/><Field label="OpenWrt version" value={v.openwrtVersion||''} onChange={x=>setV({...v,openwrtVersion:x})}/><button className="primary-button full">حفظ</button></form></Modal>}`;
const formNew=`function RouterForm({onClose,onDone}:{onClose:()=>void;onDone:()=>void}){const [v,setV]=useState<any>({});const [customers,setCustomers]=useState<any[]>([]);const [services,setServices]=useState<any[]>([]);const [error,setError]=useState('');const [saving,setSaving]=useState(false);useEffect(()=>{void api('/api/v1/admin/customers').then(setCustomers).catch(e=>setError(e.message))},[]);useEffect(()=>{if(!v.customerId){setServices([]);return}void api('/api/v1/admin/services').then((x:any[])=>setServices(x.filter(s=>s.customer_code===customers.find(c=>c.id===v.customerId)?.public_code&&['PROVISIONING','ACTIVE','SUSPENDED'].includes(s.status)&&s.config_code))).catch(e=>setError(e.message))},[v.customerId,customers]);const save=async(e:FormEvent)=>{e.preventDefault();setSaving(true);setError('');try{await api('/api/v1/admin/routers',{method:'POST',body:JSON.stringify(v)});onDone()}catch(e:any){setError(e.message)}finally{setSaving(false)}};return <Modal title="تسجيل راوتر وربطه بكونفيج" onClose={onClose}><form onSubmit={save}><Field label="Serial Number" value={v.serialNumber||''} onChange={x=>setV({...v,serialNumber:x})}/><Field label="Device ID" value={v.deviceIdentifier||''} onChange={x=>setV({...v,deviceIdentifier:x})}/><Field label="Model" value={v.model||''} onChange={x=>setV({...v,model:x})}/><Field label="Firmware" value={v.openwrtVersion||''} onChange={x=>setV({...v,openwrtVersion:x})}/><label>العميل<select value={v.customerId||''} onChange={e=>setV({...v,customerId:e.target.value,configId:''})} required><option value="">اختر العميل</option>{customers.map(c=><option key={c.id} value={c.id}>{c.full_name} · {c.public_code}</option>)}</select></label><label>الكونفيج المرتبط<select value={v.configId||''} onChange={e=>setV({...v,configId:e.target.value})} required disabled={!v.customerId}><option value="">اختر الكونفيج</option>{services.map(s=><option key={s.config_code} value={s.config_id||s.configId||''}>{s.config_code} · {s.public_code} · {s.category} · {s.protocol}</option>)}</select></label>{v.customerId&&!services.length&&<div className="alert">لا توجد كونفيجات نشطة متاحة لهذا العميل.</div>}{error&&<div className="alert error">{error}</div>}<button className="primary-button full" disabled={saving||!v.configId}>{saving?'جاري الحفظ...':'حفظ الراوتر'}</button></form></Modal>}`;
// The services API must expose config_id for the select value.
const servicesSelectOld="cfg.public_code config_code,h.city,h.country,se.public_code endpoint_code";
const servicesSelectNew="cfg.id config_id,cfg.public_code config_code,h.city,h.country,se.public_code endpoint_code";
w=replaceOnce(w,formOld,formNew,'router registration form');
write(web,w);

console.log('Router config assignment patch applied.');
