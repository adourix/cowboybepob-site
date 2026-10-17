import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
execFileSync(process.execPath,[path.join(root,'scripts/unify-services-ui.mjs')],{stdio:'inherit'});

for(const file of [path.join(root,'apps/web/src/app.tsx'),path.join(root,'apps/web/src/main.tsx')]){
  let s=fs.readFileSync(file,'utf8');
  s=s.replace("Activity,Box,CreditCard", "Activity,CreditCard");
  const old=`<CatalogCard title="الفئات" items={d.categories} onAdd={()=>setKind('category')} render={(x:any)=>\`${x.name} · ${x.protocol}\`}/><CatalogCard title="الباقات" items={d.plans} onAdd={()=>setKind('plan')} render={(x:any)=>\`${x.name} · ${money(x.price_minor)}\`}/><CatalogCard title="الراوترات" items={d.routerProducts} onAdd={()=>setKind('router')} render={(x:any)=>\`${x.name} · ${money(x.price_minor)}\`}/>`;
  const next=`<CatalogCard title="الفئات" items={d.categories} onAdd={()=>setKind('category')} onDelete={async(id)=>{await api('/api/v1/admin/catalog/categories/'+id,{method:'DELETE'});load()}} render={(x:any)=>\`${x.name} · ${x.protocol}\`}/><CatalogCard title="الباقات" items={d.plans} onAdd={()=>setKind('plan')} onDelete={async(id)=>{await api('/api/v1/admin/catalog/plans/'+id,{method:'DELETE'});load()}} render={(x:any)=>\`${x.name} · ${money(x.price_minor)}\`}/><CatalogCard title="الراوترات" items={d.routerProducts} onAdd={()=>setKind('router')} onDelete={async(id)=>{await api('/api/v1/admin/catalog/router-products/'+id,{method:'DELETE'});load()}} render={(x:any)=>\`${x.name} · ${money(x.price_minor)}\`}/>`;
  if(!s.includes(old)) throw new Error('catalog cards marker missing');
  s=s.replace(old,next);
  const oldCard=`function CatalogCard({title,items,onAdd,render}:{title:string;items:any[];onAdd:()=>void;render:(x:any)=>string}){return <section className="panel list-card"><div className="panel-head"><div><h2>{title}</h2><p>{items.length} عنصر</p></div><button className="icon-button" onClick={onAdd}><Plus size={16}/></button></div>{items.slice(0,12).map((x,i)=><div className="list-row" key={x.id||i}><span className="dot"/><b>{render(x)}</b></div>)}{!items.length&&<div className="empty">لا توجد عناصر</div>}</section>}`;
  const newCard=`function CatalogCard({title,items,onAdd,onDelete,render}:{title:string;items:any[];onAdd:()=>void;onDelete?:(id:string)=>Promise<void>;render:(x:any)=>string}){const remove=async(x:any)=>{if(!confirm('حذف هذا العنصر نهائيًا؟'))return;try{await onDelete?.(x.id)}catch(e:any){alert(e.message)}};return <section className="panel list-card"><div className="panel-head"><div><h2>{title}</h2><p>{items.length} عنصر</p></div><button className="icon-button" onClick={onAdd}><Plus size={16}/></button></div>{items.slice(0,12).map((x,i)=><div className="list-row" key={x.id||i}><span className="dot"/><b>{render(x)}</b>{onDelete&&<button className="danger-button compact" type="button" onClick={()=>void remove(x)}><Trash2 size={14}/> حذف</button>}</div>)}{!items.length&&<div className="empty">لا توجد عناصر</div>}</section>}`;
  if(!s.includes(oldCard)) throw new Error('CatalogCard marker missing');
  s=s.replace(oldCard,newCard);
  fs.writeFileSync(file,s);
}
console.log('Finalized unified services/catalog UI.');
