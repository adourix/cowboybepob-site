import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appPath = path.join(root, 'apps/web/src/app.tsx');
const mainPath = path.join(root, 'apps/web/src/main.tsx');
const apiPath = path.join(root, 'apps/api/src/main.ts');

function mustReplace(src, old, next, label) {
  if (!src.includes(old)) throw new Error(`missing marker: ${label}`);
  return src.replace(old, next);
}

function transformWeb(file) {
  let s = fs.readFileSync(file, 'utf8');

  s = mustReplace(
    s,
    "['/admin/configs','الكونفيجات',Box],",
    '',
    'config nav'
  );

  s = mustReplace(
    s,
    "services:{title:'الخدمات',endpoint:'/api/v1/admin/services',cols:['الكود','العميل','الفئة','البروتوكول','الحالة','الانتهاء'],keys:['public_code','customer_name','category','protocol','status','current_period_end']},",
    "services:{title:'الخدمات',endpoint:'/api/v1/admin/services',cols:['الكود','العميل','الفئة','البروتوكول','الكونفيج','الراوتر','الحالة','الانتهاء'],keys:['public_code','customer_name','category','protocol','config_code','router_code','status','current_period_end']},",
    'services metadata'
  );

  s = mustReplace(s, "const canAdd=['customers','routers','servers'].includes(kind);", "const canAdd=['customers','services','routers','servers'].includes(kind);", 'services add button');

  s = mustReplace(
    s,
    "{open&&kind==='customers'&&<CustomerForm onClose={()=>setOpen(false)} onDone={()=>{setOpen(false);load()}}/>}",
    "{open&&kind==='customers'&&<CustomerForm onClose={()=>setOpen(false)} onDone={()=>{setOpen(false);load()}}/>}{open&&kind==='services'&&<ServiceManualForm onClose={()=>setOpen(false)} onDone={()=>{setOpen(false);load()}}/>}",
    'service modal mount'
  );

  const configPageRe = /\nfunction ConfigsPage\(\).*?\nfunction SettingsPage/s;
  if (!configPageRe.test(s)) throw new Error('missing ConfigsPage block');
  s = s.replace(configPageRe, '\nfunction SettingsPage');

  s = mustReplace(
    s,
    "<Route path=\"/admin/configs\" element={<ConfigsPage/>}/>",
    '',
    'config route'
  );

  const routerMarker = "function RouterForm({onClose,onDone}:{onClose:()=>void;onDone:()=>void}){";
  if (!s.includes(routerMarker)) throw new Error('missing RouterForm marker');

  const manualForm = `function ServiceManualForm({onClose,onDone}:{onClose:()=>void;onDone:()=>void}){
  const [v,setV]=useState<any>({});
  const [customers,setCustomers]=useState<any[]>([]);
  const [catalog,setCatalog]=useState<any>({categories:[],plans:[]});
  const [routers,setRouters]=useState<any[]>([]);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  useEffect(()=>{void Promise.all([api('/api/v1/admin/customers'),api('/api/v1/admin/catalog'),api('/api/v1/admin/routers')]).then(([c,cat,r])=>{setCustomers(c);setCatalog(cat);setRouters(r)}).catch(e=>setError(e.message))},[]);
  const save=async(e:FormEvent)=>{e.preventDefault();setSaving(true);setError('');try{await api('/api/v1/admin/services/manual',{method:'POST',body:JSON.stringify({customerId:v.customerId,planId:v.planId||null,categoryId:v.planId?null:v.categoryId||null,routerId:v.routerId||null,label:v.label||'',link:v.link})});onDone()}catch(e:any){setError(e.message)}finally{setSaving(false)}};
  const customerRouters=routers.filter(r=>!r.customer_id||r.customer_id===v.customerId);
  return <Modal title="إضافة خدمة / كونفيج يدوي" onClose={onClose}><form onSubmit={save}>
    <label>العميل<select value={v.customerId||''} onChange={e=>setV({...v,customerId:e.target.value,routerId:''})} required><option value="">اختر العميل</option>{customers.map(c=><option key={c.id} value={c.id}>{c.full_name} · {c.public_code}</option>)}</select></label>
    <label>الباقة<select value={v.planId||''} onChange={e=>setV({...v,planId:e.target.value,categoryId:''})}><option value="">بدون باقة / خدمة يدوية</option>{(catalog.plans||[]).filter((p:any)=>p.status==='ACTIVE').map((p:any)=><option key={p.id} value={p.id}>{p.category_name} · {p.name} · {money(p.price_minor,p.currency)}</option>)}</select></label>
    {!v.planId&&<label>الفئة<select value={v.categoryId||''} onChange={e=>setV({...v,categoryId:e.target.value})} required><option value="">اختر الفئة</option>{(catalog.categories||[]).filter((c:any)=>c.status==='ACTIVE').map((c:any)=><option key={c.id} value={c.id}>{c.name} · {c.protocol}</option>)}</select></label>}
    <label>الراوتر (اختياري)<select value={v.routerId||''} onChange={e=>setV({...v,routerId:e.target.value})}><option value="">بدون راوتر</option>{customerRouters.map(r=><option key={r.id} value={r.id}>{r.public_code} · {r.model} · {r.lifecycle_status}</option>)}</select></label>
    <Field label="اسم الخدمة (اختياري)" value={v.label||''} onChange={x=>setV({...v,label:x})}/>
    <label>رابط VLESS / VMess<textarea value={v.link||''} onChange={e=>setV({...v,link:e.target.value})} placeholder="vless://... أو vmess://..." required style={{minHeight:110}}/></label>
    {error&&<div className="alert error">{error}</div>}
    <button className="primary-button full" disabled={saving||!v.customerId||(!v.planId&&!v.categoryId)||!v.link}>{saving?'جاري الحفظ...':'إنشاء الخدمة والكونفيج'}</button>
  </form></Modal>
}
`;
  s = s.replace(routerMarker, manualForm + routerMarker);

  // Keep the unused historical entry file synchronized so it cannot drift from production UI.
  fs.writeFileSync(file, s);
  return s;
}

function transformApi(file) {
  let s = fs.readFileSync(file, 'utf8');
  const marker = "  admin.get('/configs', async (req:Req) =>";
  if (!s.includes(marker)) throw new Error('missing admin config route marker');

  const deleteRoutes = `  admin.delete('/catalog/categories/:id', async (req:any) => { requirePermission(req,'catalog:write'); requireCsrf(req); const c=await pool.connect(); try { await c.query('BEGIN'); const row=await c.query('SELECT id,name FROM config_categories WHERE id=$1 FOR UPDATE',[req.params.id]); if(!row.rowCount) throw Object.assign(new Error('الفئة غير موجودة'),{statusCode:404}); const used=await c.query('SELECT count(*)::int count FROM config_plans WHERE category_id=$1',[req.params.id]); if(Number(used.rows[0].count)>0) throw Object.assign(new Error('لا يمكن حذف الفئة لأنها تحتوي على باقات. احذف الباقات أولًا.'),{statusCode:409}); await audit(c,req,'catalog.category.deleted','config_categories',req.params.id,{name:row.rows[0].name,hardDelete:true}); await c.query('DELETE FROM config_categories WHERE id=$1',[req.params.id]); await c.query('COMMIT'); return {ok:true}; } catch(e){await c.query('ROLLBACK');throw e} finally{c.release()} });
  admin.delete('/catalog/plans/:id', async (req:any) => { requirePermission(req,'catalog:write'); requireCsrf(req); const c=await pool.connect(); try { await c.query('BEGIN'); const row=await c.query('SELECT id,name FROM config_plans WHERE id=$1 FOR UPDATE',[req.params.id]); if(!row.rowCount) throw Object.assign(new Error('الباقة غير موجودة'),{statusCode:404}); const used=await c.query('SELECT (SELECT count(*) FROM services WHERE plan_id=$1)+(SELECT count(*) FROM order_items WHERE plan_id=$1) count',[req.params.id]); if(Number(used.rows[0].count)>0) throw Object.assign(new Error('لا يمكن حذف الباقة لأنها مستخدمة في خدمات أو طلبات.'),{statusCode:409}); await audit(c,req,'catalog.plan.deleted','config_plans',req.params.id,{name:row.rows[0].name,hardDelete:true}); await c.query('DELETE FROM config_plans WHERE id=$1',[req.params.id]); await c.query('COMMIT'); return {ok:true}; } catch(e){await c.query('ROLLBACK');throw e} finally{c.release()} });
  admin.delete('/catalog/router-products/:id', async (req:any) => { requirePermission(req,'catalog:write'); requireCsrf(req); const c=await pool.connect(); try { await c.query('BEGIN'); const row=await c.query('SELECT id,name FROM router_products WHERE id=$1 FOR UPDATE',[req.params.id]); if(!row.rowCount) throw Object.assign(new Error('منتج الراوتر غير موجود'),{statusCode:404}); const used=await c.query('SELECT count(*)::int count FROM order_items WHERE router_product_id=$1',[req.params.id]); if(Number(used.rows[0].count)>0) throw Object.assign(new Error('لا يمكن حذف منتج الراوتر لأنه مستخدم في طلبات.'),{statusCode:409}); await audit(c,req,'catalog.router_product.deleted','router_products',req.params.id,{name:row.rows[0].name,hardDelete:true}); await c.query('DELETE FROM router_products WHERE id=$1',[req.params.id]); await c.query('COMMIT'); return {ok:true}; } catch(e){await c.query('ROLLBACK');throw e} finally{c.release()} });
`;
  s = s.replace(marker, deleteRoutes + marker);
  fs.writeFileSync(file, s);
}

const app = transformWeb(appPath);
if (fs.existsSync(mainPath)) fs.writeFileSync(mainPath, app);
transformApi(apiPath);

console.log('Unified services/config UI and added catalog delete APIs.');
