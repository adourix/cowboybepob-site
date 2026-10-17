from pathlib import Path

api = Path('apps/api/src/main.ts')
text = api.read_text()
marker = "  admin.get('/payments', async (req:Req) => { requirePermission(req,'payments:read'); return (await db(`SELECT p.*,o.public_code order_code,c.full_name customer_name FROM payments p JOIN orders o ON o.id=p.order_id JOIN customers c ON c.id=o.customer_id ORDER BY p.created_at DESC LIMIT 200`)).rows; });"
addition = r'''  admin.get('/payments', async (req:Req) => { requirePermission(req,'payments:read'); return (await db(`SELECT p.*,o.public_code order_code,c.full_name customer_name FROM payments p JOIN orders o ON o.id=p.order_id JOIN customers c ON c.id=o.customer_id ORDER BY p.created_at DESC LIMIT 200`)).rows; });
  admin.post('/payments/:id/confirm', async (req:any) => {
    requirePermission(req,'payments:write'); requireCsrf(req);
    const c=await pool.connect();
    try {
      await c.query('BEGIN');
      const r=await c.query(`SELECT p.*,o.customer_id,o.public_code order_code,o.total_minor,o.currency order_currency,o.status order_status FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1 FOR UPDATE`,[req.params.id]);
      if(!r.rowCount) throw Object.assign(new Error('الدفعة غير موجودة'),{statusCode:404});
      const p=r.rows[0];
      if(p.status==='SUCCEEDED') { await c.query('COMMIT'); return p; }
      if(!['INITIATED','PENDING'].includes(String(p.status))) throw Object.assign(new Error('لا يمكن تأكيد هذه الدفعة في حالتها الحالية'),{statusCode:409});
      if(Number(p.amount_minor)!==Number(p.total_minor)) throw Object.assign(new Error('مبلغ الدفعة لا يطابق إجمالي الطلب'),{statusCode:409});
      if(p.order_status==='CANCELLED') throw Object.assign(new Error('لا يمكن تأكيد دفع طلب ملغى'),{statusCode:409});
      const pay=await c.query(`UPDATE payments SET status='SUCCEEDED',paid_at=COALESCE(paid_at,now()),recorded_by_staff_id=$1,updated_at=now() WHERE id=$2 RETURNING *`,[req.principal!.id,p.id]);
      const order=await c.query(`UPDATE orders SET status='PAID',paid_at=COALESCE(paid_at,now()),updated_at=now() WHERE id=$1 RETURNING id`,[p.order_id]);
      if(order.rowCount) await c.query(`INSERT INTO jobs(type,key,subject_type,subject_id,payload) VALUES('fulfill_order',$1,'ORDER',$2,$3) ON CONFLICT(key) DO NOTHING`,[`fulfill:${p.order_id}`,p.order_id,JSON.stringify({orderId:p.order_id})]);
      await audit(c,req,'payment.confirmed','payments',p.id,{gateway:p.gateway,method:p.method,amountMinor:Number(p.amount_minor),orderCode:p.order_code},p.customer_id);
      await c.query('COMMIT');
      return pay.rows[0];
    } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  });
  admin.post('/payments/:id/reject', async (req:any) => {
    requirePermission(req,'payments:write'); requireCsrf(req);
    const c=await pool.connect();
    try {
      await c.query('BEGIN');
      const r=await c.query(`SELECT p.*,o.public_code order_code,o.status order_status,o.customer_id FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=$1 FOR UPDATE`,[req.params.id]);
      if(!r.rowCount) throw Object.assign(new Error('الدفعة غير موجودة'),{statusCode:404});
      const p=r.rows[0];
      if(p.status==='FAILED') { await c.query('COMMIT'); return p; }
      if(!['INITIATED','PENDING'].includes(String(p.status))) throw Object.assign(new Error('لا يمكن رفض هذه الدفعة في حالتها الحالية'),{statusCode:409});
      const reason=String(req.body?.reason||'رفض الدفع اليدوي').trim().slice(0,500);
      const pay=await c.query(`UPDATE payments SET status='FAILED',raw=COALESCE(raw,'{}'::jsonb)||jsonb_build_object('rejectionReason',$1),updated_at=now() WHERE id=$2 RETURNING *`,[reason,p.id]);
      await audit(c,req,'payment.rejected','payments',p.id,{reason,orderCode:p.order_code},p.customer_id);
      await c.query('COMMIT');
      return pay.rows[0];
    } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  });'''
if marker not in text:
    raise SystemExit('payments marker not found')
if "admin.post('/payments/:id/confirm'" not in text:
    api.write_text(text.replace(marker, addition, 1))

web = Path('apps/web/src/main.tsx')
w = web.read_text()
start = w.index('function ResourcePage(')
end = w.index('function CustomerForm(', start)
new_resource = r'''function ResourcePage({kind}:{kind:Kind}){const m=meta[kind];const[rows,setRows]=useState<any[]>([]);const[q,setQ]=useState('');const[open,setOpen]=useState(false);const[error,setError]=useState('');const[busy,setBusy]=useState(false);const load=async()=>{setBusy(true);setError('');try{const x=await api(m.endpoint+(q&&kind!=='subscriptions'?`?q=${encodeURIComponent(q)}`:''));let list=Array.isArray(x)?x:[];if(kind==='subscriptions')list=list.filter((r:any)=>r.subscription_status);if(q)list=list.filter((r:any)=>JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));setRows(list)}catch(e:any){setError(e.message)}finally{setBusy(false)}};useEffect(()=>{void load();const id=window.setInterval(()=>void load(),15000);return()=>window.clearInterval(id)},[q]);const add=kind==='customers'||kind==='routers'||kind==='servers';const remove=async(id:string,name:string)=>{if(!window.confirm(`حذف الخادم «${name}»؟`))return;try{await api(`/api/v1/admin/servers/hosts/${id}`,{method:'DELETE'});await load()}catch(e:any){setError(e.message)}};const confirmPayment=async(id:string)=>{if(!window.confirm('تأكيد استلام الدفع لهذا الطلب؟ سيتم تحويل الطلب إلى مدفوع وتشغيل التجهيز تلقائيًا.'))return;setBusy(true);setError('');try{await api(`/api/v1/admin/payments/${id}/confirm`,{method:'POST',body:JSON.stringify({})});await load()}catch(e:any){setError(e.message)}finally{setBusy(false)}};const rejectPayment=async(id:string)=>{const reason=window.prompt('سبب رفض الدفع:','لم يتم استلام/مطابقة التحويل');if(reason===null)return;setBusy(true);setError('');try{await api(`/api/v1/admin/payments/${id}/reject`,{method:'POST',body:JSON.stringify({reason})});await load()}catch(e:any){setError(e.message)}finally{setBusy(false)}};return <div className="page"><Heading title={m.title} sub={kind==='payments'?'مراجعة وتأكيد المدفوعات اليدوية من هنا.':'بيانات حقيقية من الـAPI.'} onAdd={add?()=>setOpen(true):undefined} addText={kind==='customers'?'إضافة عميل':kind==='routers'?'تسجيل راوتر':'إضافة خادم'}/><section className="panel table-panel"><div className="toolbar"><label className="search wide"><Search size={16}/><input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&load()} placeholder="بحث..."/></label><button className="secondary-button" type="button" onClick={()=>void load()} disabled={busy}><RefreshCw size={15}/> تحديث</button></div>{error&&<div className="alert error">{error}</div>}<div className="table-wrap"><table><thead><tr>{m.cols.map(x=><th key={x}>{x}</th>)}{kind==='servers'&&<th>إجراءات</th>}{kind==='payments'&&<th>إجراءات</th>}</tr></thead><tbody>{rows.length===0?<tr><td className="empty" colSpan={m.cols.length+((kind==='servers'||kind==='payments')?1:0)}>{busy?'جارٍ التحميل...':'لا توجد بيانات'}</td></tr>:rows.map((r,i)=><tr key={r.id||i}>{m.keys.map(k=><td key={k}>{k==='email_verified_at'?(r[k]?'مؤكد':'غير مؤكد'):k.includes('minor')?money(r[k]):k==='used_bytes'?formatBytes(r[k]):k.endsWith('_at')||['starts_at','current_period_end','last_seen_at','created_at'].includes(k)?date(r[k]):['status','connectivity','state','lifecycle_status','subscription_status','health_status'].includes(k)?<span className="badge">{label(r[k])}</span>:String(r[k]??'—')}</td>)}{kind==='servers'&&<td><button className="danger-button" type="button" onClick={()=>remove(r.id,r.name||r.address||'هذا الخادم')}>حذف</button></td>}{kind==='payments'&&<td><div className="row-actions">{['INITIATED','PENDING'].includes(String(r.status))&&<><button className="primary-button compact" type="button" onClick={()=>void confirmPayment(r.id)} disabled={busy}>تأكيد الدفع</button><button className="danger-button" type="button" onClick={()=>void rejectPayment(r.id)} disabled={busy}>رفض</button></>}{r.status==='SUCCEEDED'&&<span className="badge success-badge">تم التأكيد</span>}{r.status==='FAILED'&&<span className="badge">مرفوض</span>}</div></td>}</tr>)}</tbody></table></div></section>{open&&kind==='customers'&&<CustomerForm onClose={()=>setOpen(false)} onDone={()=>{setOpen(false);void load()}}/>}{open&&kind==='routers'&&<RouterForm onClose={()=>setOpen(false)} onDone={()=>{setOpen(false);void load()}}/>}{open&&kind==='servers'&&<ServerForm onClose={()=>setOpen(false)} onDone={()=>{setOpen(false);void load()}}/>}</div>}
'''
w = w[:start] + new_resource + w[end:]
web.write_text(w)

css = Path('apps/web/src/styles.css')
s = css.read_text()
if '.row-actions' not in s:
    s += '\n.row-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.primary-button.compact{padding:7px 10px;font-size:12px}.success-badge{font-weight:700}\n'
css.write_text(s)
