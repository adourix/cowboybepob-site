import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const files=[path.join(root,'apps/web/src/app.tsx'),path.join(root,'apps/web/src/main.tsx')];

function ensureBaseUnification(){
  const probe=fs.readFileSync(files[0],'utf8');
  if(!probe.includes('function ServiceManualForm(')){
    execFileSync(process.execPath,[path.join(root,'scripts/unify-services-ui.mjs')],{stdio:'inherit'});
  }
}

function patchWeb(file){
  let s=fs.readFileSync(file,'utf8');
  s=s.replace("Activity,Box,CreditCard", "Activity,CreditCard");
  s=s.replace("Activity,CreditCard,Box", "Activity,CreditCard");

  // Replace the entire Catalog function instead of relying on fragile exact JSX strings.
  const catalogRe=/function Catalog\(\)\{[\s\S]*?\nfunction CatalogCard/;
  if(!catalogRe.test(s)) throw new Error(`missing Catalog function in ${file}`);
  const catalogFn=`function Catalog(){
  const [d,setD]=useState<any>({categories:[],plans:[],routerProducts:[]});
  const [kind,setKind]=useState('');
  const [v,setV]=useState<any>({protocol:'vless',status:'ACTIVE',durationDays:30,currency:'EGP',priceMinor:15000});
  const load=()=>api('/api/v1/admin/catalog').then(setD);
  useEffect(()=>{void load();},[]);
  const save=async(e:FormEvent)=>{e.preventDefault();const path=kind==='category'?'/api/v1/admin/catalog/categories':kind==='plan'?'/api/v1/admin/catalog/plans':'/api/v1/admin/catalog/router-products';await api(path,{method:'POST',body:JSON.stringify(kind==='category'?v:kind==='plan'?{...v,priceMinor:Number(v.priceMinor),durationDays:Number(v.durationDays),quotaBytes:v.quotaBytes?Number(v.quotaBytes):null}:{...v,priceMinor:Number(v.priceMinor)})});setKind('');await load()};
  const remove=async(path:string,id:string)=>{if(!confirm('حذف هذا العنصر نهائيًا؟'))return;try{await api(path+'/'+id,{method:'DELETE'});await load()}catch(e:any){alert(e.message)}};
  return <div className="page"><Heading title="الكتالوج" sub="الفئات والباقات ومنتجات الراوتر."/><div className="catalog-grid">
    <CatalogCard title="الفئات" items={d.categories} onAdd={()=>setKind('category')} onDelete={id=>remove('/api/v1/admin/catalog/categories',id)} render={(x:any)=>x.name+' · '+x.protocol}/>
    <CatalogCard title="الباقات" items={d.plans} onAdd={()=>setKind('plan')} onDelete={id=>remove('/api/v1/admin/catalog/plans',id)} render={(x:any)=>x.name+' · '+money(x.price_minor)}/>
    <CatalogCard title="الراوترات" items={d.routerProducts} onAdd={()=>setKind('router')} onDelete={id=>remove('/api/v1/admin/catalog/router-products',id)} render={(x:any)=>x.name+' · '+money(x.price_minor)}/>
  </div>{kind&&<Modal title={kind==='category'?'فئة جديدة':kind==='plan'?'باقة جديدة':'منتج راوتر جديد'} onClose={()=>setKind('')}><form onSubmit={save}>{kind==='category'?<><Field label="الاسم" value={v.name||''} onChange={x=>setV({...v,name:x})}/><Field label="Slug" value={v.slug||''} onChange={x=>setV({...v,slug:x})}/><label>Protocol<select value={v.protocol} onChange={e=>setV({...v,protocol:e.target.value})}><option value="vless">VLESS</option><option value="vmess">VMess</option></select></label></>:kind==='plan'?<><label>الفئة<select value={v.categoryId||''} onChange={e=>setV({...v,categoryId:e.target.value})}><option value="">اختر</option>{d.categories.map((x:any)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><Field label="اسم الباقة" value={v.name||''} onChange={x=>setV({...v,name:x})}/><Field label="المدة بالأيام" value={v.durationDays} onChange={x=>setV({...v,durationDays:x})} type="number"/><Field label="السعر بالقرش" value={v.priceMinor} onChange={x=>setV({...v,priceMinor:x})} type="number"/><Field label="Quota bytes" value={v.quotaBytes||''} onChange={x=>setV({...v,quotaBytes:x})} type="number"/></>:<><Field label="SKU" value={v.sku||''} onChange={x=>setV({...v,sku:x})}/><Field label="الاسم" value={v.name||''} onChange={x=>setV({...v,name:x})}/><Field label="الموديل" value={v.model||''} onChange={x=>setV({...v,model:x})}/><Field label="السعر بالقرش" value={v.priceMinor} onChange={x=>setV({...v,priceMinor:x})} type="number"/></>}<button className="primary-button full">حفظ</button></form></Modal>}</div>}
function CatalogCard`;
  s=s.replace(catalogRe,catalogFn);

  const cardRe=/function CatalogCard\([\s\S]*?\nfunction CustomerPortal/;
  if(!cardRe.test(s)) throw new Error(`missing CatalogCard block in ${file}`);
  const card=`function CatalogCard({title,items,onAdd,onDelete,render}:{title:string;items:any[];onAdd:()=>void;onDelete?:(id:string)=>Promise<void>;render:(x:any)=>string}){const remove=async(x:any)=>{if(!confirm('حذف هذا العنصر نهائيًا؟'))return;try{await onDelete?.(x.id)}catch(e:any){alert(e.message)}};return <section className="panel list-card"><div className="panel-head"><div><h2>{title}</h2><p>{items.length} عنصر</p></div><button className="icon-button" onClick={onAdd}><Plus size={16}/></button></div>{items.slice(0,12).map((x,i)=><div className="list-row" key={x.id||i}><span className="dot"/><b>{render(x)}</b>{onDelete&&<button className="danger-button compact" type="button" onClick={()=>void remove(x)}><Trash2 size={14}/> حذف</button>}</div>)}{!items.length&&<div className="empty">لا توجد عناصر</div>}</section>}
function CustomerPortal`;
  s=s.replace(cardRe,card);
  fs.writeFileSync(file,s);
}

ensureBaseUnification();
for(const file of files) patchWeb(file);
console.log('Finalized unified services/catalog UI.');
