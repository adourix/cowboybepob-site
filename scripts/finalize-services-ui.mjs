import fs from 'node:fs';

const root = new URL('../', import.meta.url).pathname;
const files = [
  `${root}apps/web/src/app.tsx`,
  `${root}apps/web/src/main.tsx`,
  `${root}apps/api/src/main.ts`,
];

function read(p){ return fs.readFileSync(p,'utf8'); }
function write(p,s){ fs.writeFileSync(p,s); console.log(`updated ${p}`); }
function replaceOnce(s, old, next, label){
  const n=(s.match(new RegExp(old.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&'),'g'))||[]).length;
  if(n!==1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return s.replace(old,next);
}

function patchWeb(path){
  let s=read(path);

  // Remove duplicate top-level navigation entries. Keep the database/API resource intact.
  s=s.replace(",['/admin/subscriptions','الاشتراكات',CreditCard]",'');
  s=s.replace(",['/admin/configs','الكونفيجات',Box]",'');

  // Services become the single admin UI surface for service + current subscription + current config.
  s=s.replace(
    "services:{title:'الخدمات',endpoint:'/api/v1/admin/services',cols:['الكود','العميل','الفئة','البروتوكول','الحالة','الانتهاء'],keys:['public_code','customer_name','category','protocol','status','current_period_end']}",
    "services:{title:'الخدمات',endpoint:'/api/v1/admin/services',cols:['الخدمة','الاشتراك','العميل','الفئة','البروتوكول','الكونفيج','الراوتر','حالة الخدمة','حالة الاشتراك','الاستخدام','الانتهاء'],keys:['public_code','subscription_code','customer_name','category','protocol','config_code','router_code','status','subscription_status','usage_display','current_period_end']}"
  );

  // Resource renderer: show a human-readable quota without changing API contracts.
  const oldCell="k.includes('minor')?money(r[k]):k.endsWith('_at')||k.includes('date')?date(r[k]):['status','connectivity','state','lifecycle_status','health_status'].includes(k)?<span className=\"badge\">{label(r[k])}</span>:String(r[k]??'—')";
  const newCell="k==='usage_display'?String(r[k]??'—'):k.includes('minor')?money(r[k]):k.endsWith('_at')||k.includes('date')?date(r[k]):['status','connectivity','state','lifecycle_status','health_status','subscription_status'].includes(k)?<span className=\"badge\">{label(r[k])}</span>:String(r[k]??'—')";
  if(s.includes(oldCell)) s=s.replace(oldCell,newCell);

  // Never expose subscriptions as a separate route from the admin UI.
  s=s.replace("<Route path=\"/admin/subscriptions\" element={<ResourcePage kind=\"subscriptions\" user={user}/>}/>",'');
  s=s.replace("<Route path=\"/admin/configs\" element={<ResourcePage kind=\"configs\" user={user}/>}/>",'');
  s=s.replace("<Route path=\"/admin/subscriptions\" element={<ResourcePage kind={'subscriptions'} user={user}/>}/>",'');

  // Redirect legacy URLs to the canonical Services screen.
  if(!s.includes("function LegacyAdminRedirect")){
    const marker="function RouterForm(";
    const idx=s.indexOf(marker);
    if(idx<0) throw new Error(`${path}: RouterForm marker missing`);
    s=s.slice(0,idx)+"function LegacyAdminRedirect(){const nav=useNavigate();useEffect(()=>{nav('/admin/services',{replace:true})},[nav]);return null}\n"+s.slice(idx);
  }
  s=s.replace("<Route path=\"/admin/subscriptions\" element={<ResourcePage kind=\"subscriptions\" user={user}/>}/>","<Route path=\"/admin/subscriptions\" element={<LegacyAdminRedirect/>}/>");
  s=s.replace("<Route path=\"/admin/configs\" element={<ResourcePage kind=\"configs\" user={user}/>}/>","<Route path=\"/admin/configs\" element={<LegacyAdminRedirect/>}/>");

  write(path,s);
}

function patchApi(path){
  let s=read(path);
  const old="SELECT s.id,s.public_code,s.label,s.status,s.provisioning_mode,s.created_at,c.name category,c.protocol,sub.status subscription_status,sub.current_period_end,sub.starts_at,sub.used_bytes,sub.quota_bytes,cu.public_code customer_code";
  const next="SELECT s.id,s.public_code,s.label,s.status,s.provisioning_mode,s.created_at,c.name category,c.protocol,sub.public_code subscription_code,sub.status subscription_status,sub.current_period_end,sub.starts_at,sub.used_bytes,sub.quota_bytes,cu.public_code customer_code";
  if(!s.includes(next)){
    if(!s.includes(old)) throw new Error(`${path}: services SQL marker missing`);
    s=s.replace(old,next);
  }
  write(path,s);
}

for(const p of files) {
  if(!fs.existsSync(p)) throw new Error(`missing ${p}`);
}
patchWeb(files[0]);
patchWeb(files[1]);
patchApi(files[2]);
console.log('Done: Services is the canonical admin UI; subscription/config remain child data, with subscription code and usage shown in Services.');
