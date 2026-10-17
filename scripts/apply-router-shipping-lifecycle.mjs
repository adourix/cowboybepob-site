import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const file = (p) => path.join(root, p);
const read = (p) => fs.readFileSync(file(p), 'utf8');
const write = (p, s) => fs.writeFileSync(file(p), s);
const replaceOnce = (source, old, next, label) => {
  if (!source.includes(old)) throw new Error(`Missing patch marker: ${label}`);
  return source.replace(old, next);
};

// API: expose router-only flag and add explicit ship/deliver transitions.
{
  const p = 'apps/api/src/main.ts';
  let s = read(p);
  if (!s.includes("admin.post('/orders/:id/ship'")) {
    s = replaceOnce(s,
      "admin.get('/orders', async (req:Req) => { requirePermission(req,'orders:read'); return (await db(`SELECT o.*,c.public_code customer_code,c.full_name customer_name,(SELECT count(*) FROM order_items oi WHERE oi.order_id=o.id)::int item_count FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.created_at DESC LIMIT 200`)).rows; });",
      "admin.get('/orders', async (req:Req) => { requirePermission(req,'orders:read'); return (await db(`SELECT o.*,c.public_code customer_code,c.full_name customer_name,(SELECT count(*) FROM order_items oi WHERE oi.order_id=o.id)::int item_count,(SELECT bool_and(oi.item_type='ROUTER') FROM order_items oi WHERE oi.order_id=o.id) router_only FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.created_at DESC LIMIT 200`)).rows; });",
      'orders GET');
    const marker = "admin.post('/orders/:id/cancel', async (req:any) => { requirePermission(req,'orders:write');requireCsrf(req);return (await db(`UPDATE orders SET status='CANCELLED',cancelled_at=now(),updated_at=now() WHERE id=$1 AND status IN ('PENDING_PAYMENT','FULFILLING') RETURNING *`,[req.params.id])).rows[0]||null; });";
    const routes = `admin.post('/orders/:id/ship', async (req:any) => {
    requirePermission(req,'orders:write'); requireCsrf(req);
    const c=await pool.connect();
    try { await c.query('BEGIN');
      const order=(await c.query(\`SELECT id,public_code,customer_id,status FROM orders WHERE id=$1 FOR UPDATE\`,[req.params.id])).rows[0];
      if(!order) throw Object.assign(new Error('الطلب غير موجود'),{statusCode:404});
      if(order.status!=='FULFILLING') throw Object.assign(new Error('لا يمكن شحن الطلب في حالته الحالية'),{statusCode:409});
      const items=(await c.query(\`SELECT id,item_type,fulfillment_status,result_router_id FROM order_items WHERE order_id=$1 ORDER BY created_at FOR UPDATE\`,[order.id])).rows;
      if(!items.length || !items.every((x:any)=>x.item_type==='ROUTER')) throw Object.assign(new Error('زر الشحن مخصص لطلبات الراوترات فقط'),{statusCode:409});
      if(!items.every((x:any)=>x.fulfillment_status==='READY_TO_SHIP' && x.result_router_id)) throw Object.assign(new Error('كل الراوترات يجب أن تكون جاهزة للشحن أولًا'),{statusCode:409});
      const routerIds=items.map((x:any)=>x.result_router_id);
      await c.query(\`UPDATE routers SET lifecycle_status='READY',shipped_at=COALESCE(shipped_at,now()),updated_at=now() WHERE id=ANY($1::uuid[])\`,[routerIds]);
      await c.query(\`UPDATE order_items SET fulfillment_status='SHIPPED',fulfillment_detail='SHIPPED' WHERE order_id=$1\`,[order.id]);
      const updated=(await c.query(\`UPDATE orders SET status='SHIPPED',updated_at=now() WHERE id=$1 RETURNING *\`,[order.id])).rows[0];
      await audit(c,req,'order.router_shipped','orders',order.id,{orderCode:order.public_code,routerIds},order.customer_id);
      await c.query('COMMIT'); return updated;
    } catch(e){await c.query('ROLLBACK');throw e} finally{c.release()}
  });
  admin.post('/orders/:id/deliver', async (req:any) => {
    requirePermission(req,'orders:write'); requireCsrf(req);
    const c=await pool.connect();
    try { await c.query('BEGIN');
      const order=(await c.query(\`SELECT id,public_code,customer_id,status FROM orders WHERE id=$1 FOR UPDATE\`,[req.params.id])).rows[0];
      if(!order) throw Object.assign(new Error('الطلب غير موجود'),{statusCode:404});
      if(order.status!=='SHIPPED') throw Object.assign(new Error('لا يمكن تسجيل التسليم قبل شحن الطلب'),{statusCode:409});
      const items=(await c.query(\`SELECT id,item_type,fulfillment_status,result_router_id FROM order_items WHERE order_id=$1 ORDER BY created_at FOR UPDATE\`,[order.id])).rows;
      if(!items.length || !items.every((x:any)=>x.item_type==='ROUTER' && x.fulfillment_status==='SHIPPED')) throw Object.assign(new Error('الطلب ليس طلب راوترات مشحونًا بالكامل'),{statusCode:409});
      await c.query(\`UPDATE order_items SET fulfillment_status='FULFILLED',fulfillment_detail='DELIVERED',fulfilled_at=now() WHERE order_id=$1\`,[order.id]);
      const updated=(await c.query(\`UPDATE orders SET status='COMPLETED',completed_at=COALESCE(completed_at,now()),updated_at=now() WHERE id=$1 RETURNING *\`,[order.id])).rows[0];
      await audit(c,req,'order.router_delivered','orders',order.id,{orderCode:order.public_code},order.customer_id);
      await c.query('COMMIT'); return updated;
    } catch(e){await c.query('ROLLBACK');throw e} finally{c.release()}
  });
  `;
    s = replaceOnce(s, marker, routes + marker, 'order ship/deliver routes');
    write(p, s);
  }
}

// Worker: router-only orders stop at READY_TO_SHIP; mixed/config orders keep the old auto-complete behavior.
{
  const p = 'apps/api/src/worker-v2.ts';
  let s = read(p);
  if (!s.includes('const routerOnly=items.rows.length>0')) {
    s = replaceOnce(s,
      "const items=await c.query(`SELECT oi.*,o.customer_id,o.status order_status FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.order_id=$1 AND (oi.fulfillment_status IN ('PENDING','IN_PROGRESS') OR (oi.fulfillment_status='NEEDS_ATTENTION' AND oi.fulfillment_detail='NO_CAPACITY')) ORDER BY CASE WHEN oi.item_type='ROUTER' THEN 0 ELSE 1 END,oi.created_at FOR UPDATE`,[job.subject_id]);let purchasedRouterId:string|null=null;",
      "const items=await c.query(`SELECT oi.*,o.customer_id,o.status order_status FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.order_id=$1 AND (oi.fulfillment_status IN ('PENDING','IN_PROGRESS') OR (oi.fulfillment_status='NEEDS_ATTENTION' AND oi.fulfillment_detail='NO_CAPACITY')) ORDER BY CASE WHEN oi.item_type='ROUTER' THEN 0 ELSE 1 END,oi.created_at FOR UPDATE`,[job.subject_id]);const routerOnly=items.rows.length>0&&items.rows.every((x:any)=>x.item_type==='ROUTER');let purchasedRouterId:string|null=null;",
      'worker routerOnly');
    s = replaceOnce(s,
      "await c.query(`UPDATE order_items SET fulfillment_status='FULFILLED',result_router_id=$1,fulfilled_at=now() WHERE id=$2`,[purchasedRouterId,item.id]);",
      "const routerFulfillment=routerOnly?'READY_TO_SHIP':'FULFILLED';await c.query(`UPDATE order_items SET fulfillment_status=$1,result_router_id=$2,fulfilled_at=CASE WHEN $1='FULFILLED' THEN now() ELSE NULL END,fulfillment_detail=CASE WHEN $1='READY_TO_SHIP' THEN 'READY_TO_SHIP' ELSE NULL END WHERE id=$3`,[routerFulfillment,purchasedRouterId,item.id]);",
      'worker router fulfillment');
    write(p, s);
  }
}

// Admin UI: show shipping/delivery actions only for router-only orders.
{
  const p = 'apps/web/src/app.tsx';
  let s = read(p);
  s = s.replace("READY:'جاهز',ASSIGNED:'مُسند',IN_STOCK:'في المخزن',ONLINE:'متصل'", "READY:'جاهز',ASSIGNED:'مُسند',IN_STOCK:'في المخزن',READY_TO_SHIP:'جاهز للشحن',SHIPPED:'تم الشحن',ONLINE:'متصل'");
  if (!s.includes('const shipRouterOrder=')) {
    const marker = "const rejectPayment=async(id:string)=>{const reason=window.prompt('سبب رفض الدفع:','لم يتم استلام/مطابقة التحويل');if(reason===null)return;setLoading(true);setError('');try{await api(`/api/v1/admin/payments/${id}/reject`,{method:'POST',body:JSON.stringify({reason})});await load()}catch(e:any){setError(e.message)}finally{setLoading(false)}};";
    const funcs = marker + "const shipRouterOrder=async(id:string)=>{if(!window.confirm('تأكيد شحن طلب الراوتر؟'))return;setLoading(true);setError('');try{await api(`/api/v1/admin/orders/${id}/ship`,{method:'POST',body:JSON.stringify({})});await load()}catch(e:any){setError(e.message)}finally{setLoading(false)}};const deliverRouterOrder=async(id:string)=>{if(!window.confirm('تأكيد استلام العميل للراوتر؟ سيتم إكمال الطلب.'))return;setLoading(true);setError('');try{await api(`/api/v1/admin/orders/${id}/deliver`,{method:'POST',body:JSON.stringify({})});await load()}catch(e:any){setError(e.message)}finally{setLoading(false)}};";
    s = replaceOnce(s, marker, funcs, 'UI order action functions');
    s = replaceOnce(s, "{['services','subscriptions','routers','servers','payments'].includes(kind)&&<td>", "{['services','subscriptions','routers','servers','payments','orders'].includes(kind)&&<td>", 'UI order action column');
    s = replaceOnce(s,
      "{kind==='payments'&&String(row.status)==='PENDING'&&<><button className=\"small-button\" onClick={()=>confirmPayment(row.id)}>تأكيد الدفع</button><button className=\"small-button danger\" onClick={()=>rejectPayment(row.id)}>رفض</button></>}",
      "{kind==='payments'&&String(row.status)==='PENDING'&&<><button className=\"small-button\" onClick={()=>confirmPayment(row.id)}>تأكيد الدفع</button><button className=\"small-button danger\" onClick={()=>rejectPayment(row.id)}>رفض</button></>}{kind==='orders'&&row.router_only&&String(row.status)==='FULFILLING'&&<button className=\"small-button\" onClick={()=>shipRouterOrder(row.id)}>شحن الطلب</button>}{kind==='orders'&&row.router_only&&String(row.status)==='SHIPPED'&&<button className=\"small-button\" onClick={()=>deliverRouterOrder(row.id)}>تم التسليم</button>}",
      'UI order action buttons');
    write(p, s);
  }
}

console.log('Router shipping lifecycle applied successfully.');
