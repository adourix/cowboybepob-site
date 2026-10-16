import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import crypto from 'node:crypto';

const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PORT = Number(process.env.PORT || 4000);
const WEB_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 7);
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

type Principal = { type: 'STAFF' | 'CUSTOMER'; id: string; role?: string; email: string; fullName: string };
type Req = FastifyRequest & { params: any; principal?: Principal; sessionId?: string; csrf?: string };

declare module 'fastify' { interface FastifyRequest { principal?: Principal; sessionId?: string; csrf?: string } }

const rolePermissions: Record<string, string[]> = {
 SUPER_ADMIN: ['*'], ADMIN: ['customers:read','customers:write','services:read','services:write','services:migrate','routers:read','routers:write','routers:provision','servers:read','servers:write','servers:migrate','providers:read','providers:write','catalog:read','catalog:write','orders:read','orders:write','payments:read','jobs:read','jobs:write','audit:read','secrets:reveal'],
 SUPPORT: ['customers:read','customers:write','services:read','services:suspend','services:resume','subscriptions:read','routers:read','orders:read','payments:read'],
 TECHNICIAN: ['customers:read','services:read','services:write','services:migrate','routers:read','routers:write','routers:provision','servers:read','servers:write','servers:migrate','providers:read','providers:write','secrets:reveal','jobs:read','jobs:write'],
 FINANCE: ['customers:read','subscriptions:read','orders:read','payments:read','payments:write','payments:refund','audit:read']
};

function sha(value: string) { return crypto.createHash('sha256').update(value).digest(); }
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function encryptSecret(value: string) {
 if (!ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is required');
 const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
 const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
 const ciphertext = Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]);
}
function decryptSecret(value: Buffer) {
 if (!ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is required');
 const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
 const iv=value.subarray(0,12), tag=value.subarray(12,28), data=value.subarray(28);
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv); decipher.setAuthTag(tag);
 return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');
}
function requirePermission(req: Req, permission: string) {
 const p=req.principal; if (!p || p.type!=='STAFF') throw Object.assign(new Error('Authentication required'),{statusCode:401});
 const allowed=rolePermissions[p.role || ''] || []; if (!allowed.includes('*') && !allowed.includes(permission)) throw Object.assign(new Error('Forbidden'),{statusCode:403});
}
function requireCsrf(req: Req) {
 const token=req.headers['x-csrf-token']; if (!req.csrf || typeof token!=='string' || token!==req.csrf) throw Object.assign(new Error('CSRF validation failed'),{statusCode:403});
}
async function audit(client: PoolClient, req: Req, action: string, entityType: string, entityId: string | null, metadata: object = {}, customerId: string | null = null) {
 await client.query('INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,customer_id,request_id,ip,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[
  req.principal?.type || 'SYSTEM', req.principal?.id || null, action, entityType, entityId, customerId, req.id, req.ip, metadata
 ]);
}
async function db<T extends QueryResultRow = any>(text:string, values:any[]=[]){ return pool.query<T>(text,values); }

async function seed() {
 await db(`INSERT INTO provider_instances(name,type,base_url,credentials_ref) VALUES($1,'MARZBAN',$2,'MARZBAN_ADMIN') ON CONFLICT(name) DO NOTHING`,['Default Marzban',process.env.MARZBAN_BASE_URL || 'http://marzban:8000']);
 const cat=await db(`INSERT INTO config_categories(name,slug,description,protocol,router_compatible,status) VALUES('VLESS Basic','vless-basic','باقة VLESS قياسية','vless',true,'ACTIVE') ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name RETURNING id`);
 if(cat.rows[0]) await db(`INSERT INTO config_plans(category_id,name,duration_days,price_minor,quota_bytes,status) VALUES($1,'30 يوم',30,15000,53687091200,'ACTIVE') ON CONFLICT(category_id,name) DO NOTHING`,[cat.rows[0].id]);
 await db(`INSERT INTO router_products(sku,name,model,price_minor,status) VALUES('CB-001','Cowboy Bebop Router','OpenWrt x86',125000,'ACTIVE') ON CONFLICT(sku) DO NOTHING`);
 const adminEmail=process.env.ADMIN_EMAIL, adminPassword=process.env.ADMIN_PASSWORD, totp=process.env.ADMIN_TOTP_SECRET;
 if(adminEmail && adminPassword) {
  const exists=await db('SELECT id FROM staff_users WHERE email=$1',[adminEmail]);
  if(!exists.rowCount) {
   if(!totp) throw new Error('ADMIN_TOTP_SECRET is required when bootstrapping the first staff account');
   const hash=await argon2.hash(adminPassword,{type:argon2.argon2id});
   await db('INSERT INTO staff_users(email,full_name,password_hash,role,totp_secret_enc,totp_enabled) VALUES($1,$2,$3,$4,$5,true)',[adminEmail,'مسؤول المنصة',hash,'SUPER_ADMIN',encryptSecret(totp)]);
   app.log.info('Initial SUPER_ADMIN created');
  }
 }
}

async function authenticate(req: Req, _reply: FastifyReply) {
 const token=req.cookies?.cb_session; if(!token) return;
 const result=await db(`SELECT s.id,s.csrf_hash,s.principal_type,s.principal_id,s.expires_at, CASE WHEN s.principal_type='STAFF' THEN st.email ELSE c.email END email, CASE WHEN s.principal_type='STAFF' THEN st.full_name ELSE c.full_name END full_name, st.role
 FROM auth_sessions s LEFT JOIN staff_users st ON s.principal_type='STAFF' AND st.id=s.principal_id LEFT JOIN customers c ON s.principal_type='CUSTOMER' AND c.id=s.principal_id
 WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`,[sha(token)]);
 if(!result.rowCount) return;
 const row=result.rows[0]; req.sessionId=row.id; req.csrf=Buffer.from(row.csrf_hash).toString('hex');
 req.principal={type:row.principal_type,id:row.principal_id,role:row.role,email:row.email,fullName:row.full_name};
}

async function createSession(reply: FastifyReply, req: Req, principal: Principal) {
 const token=randomToken(), csrf=randomToken(24), expires=new Date(Date.now()+SESSION_DAYS*86400000);
 await db('INSERT INTO auth_sessions(principal_type,principal_id,token_hash,csrf_hash,ip,user_agent,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[principal.type,principal.id,sha(token),sha(csrf),req.ip,req.headers['user-agent'] || '',expires]);
 reply.setCookie('cb_session',token,{httpOnly:true,secure:COOKIE_SECURE,sameSite:'lax',path:'/',expires});
 reply.setCookie('cb_csrf',csrf,{httpOnly:false,secure:COOKIE_SECURE,sameSite:'lax',path:'/',expires});
 return csrf;
}

function statusCode(error:any){return Number(error?.statusCode)||500;}
function money(minor:number|string,currency='EGP'){return `${(Number(minor)/100).toFixed(2)} ${currency}`;}

app.register(cors,{origin:WEB_ORIGIN,credentials:true});
app.register(cookie);
app.register(rateLimit,{max:120,timeWindow:'1 minute'});
app.addHook('preHandler',authenticate);
app.setErrorHandler((error: any, _req, reply)=>reply.code(statusCode(error)).send({error:error.message || 'Internal error'}));

app.get('/health',async()=>({ok:true,service:'cowboybepob-api',time:new Date().toISOString()}));
app.get('/api/v1/auth/me',async(req:Req)=>({user:req.principal || null,csrf:req.csrf || null}));

app.post('/api/v1/auth/login', {config:{rateLimit:{max:8,timeWindow:'1 minute'}}}, async(req:any,reply)=>{
 const {email,password,otp,kind='staff'}=req.body || {};
 if(typeof email!=='string'||typeof password!=='string') throw Object.assign(new Error('Email and password are required'),{statusCode:400});
 let result;
 if(kind==='customer') result=await db('SELECT id,email,full_name,password_hash,status FROM customers WHERE email=$1 AND status<>\'DELETED\'',[email]);
 else result=await db('SELECT id,email,full_name,password_hash,role,status,totp_enabled,totp_secret_enc FROM staff_users WHERE email=$1',[email]);
 if(!result.rowCount || result.rows[0].status==='BLOCKED' || result.rows[0].status==='DISABLED') throw Object.assign(new Error('Invalid credentials'),{statusCode:401});
 const row=result.rows[0]; if(!row.password_hash || !(await argon2.verify(row.password_hash,password))) throw Object.assign(new Error('Invalid credentials'),{statusCode:401});
 if(kind!=='customer' && row.totp_enabled){ if(typeof otp!=='string'||!row.totp_secret_enc||!authenticator.check(otp,decryptSecret(row.totp_secret_enc))) throw Object.assign(new Error('Invalid authenticator code'),{statusCode:401}); }
 const principal={type:kind==='customer'?'CUSTOMER':'STAFF',id:row.id,email:row.email,fullName:row.full_name,role:row.role} as Principal;
 const csrf=await createSession(reply,req,principal);
 if(principal.type==='STAFF') await db('UPDATE staff_users SET last_login_at=now() WHERE id=$1',[row.id]);
 const client=await pool.connect(); try {await audit(client,req,'auth.login','staff_users',row.id,{},principal.type==='CUSTOMER'?row.id:null); } finally {client.release();}
 return {user:principal,csrf};
});

app.post('/api/v1/auth/logout',async(req:Req,reply)=>{requireCsrf(req); if(req.sessionId) await db('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1',[req.sessionId]); reply.clearCookie('cb_session',{path:'/'}); reply.clearCookie('cb_csrf',{path:'/'}); return {ok:true};});

app.post('/api/v1/customer/auth/register',{config:{rateLimit:{max:5,timeWindow:'1 minute'}},},async(req:any)=>{
 const {fullName,email,password,mobilePhone,addressLine='',city='',governorate=''}=req.body||{};
 if(!fullName||!email||!password||!mobilePhone) throw Object.assign(new Error('Missing registration fields'),{statusCode:400});
 const hash=await argon2.hash(password,{type:argon2.argon2id});
 const r=await db(`INSERT INTO customers(full_name,email,password_hash,mobile_phone,address_line,city,governorate,status,email_verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,'ACTIVE',now()) RETURNING id,email,full_name`,[fullName,email,hash,mobilePhone,addressLine,city,governorate]);
 return r.rows[0];
});

app.register(async admin=>{
 admin.addHook('preHandler',async(req:Req)=>{ if(!req.principal || req.principal.type!=='STAFF') throw Object.assign(new Error('Staff authentication required'),{statusCode:401}); });
 admin.get('/dashboard',async(req:Req)=>{requirePermission(req,'services:read'); const [c,s,r,o,p,j]=await Promise.all([
  db('SELECT count(*)::int count FROM customers WHERE status<>\'DELETED\''),db("SELECT count(*)::int count FROM services WHERE status='ACTIVE'"),db("SELECT count(*)::int count FROM routers WHERE connectivity='ONLINE'"),db('SELECT count(*)::int count FROM orders'),db("SELECT coalesce(sum(amount_minor),0)::bigint total FROM payments WHERE status='SUCCEEDED' AND paid_at>=date_trunc('month',now())"),db("SELECT count(*)::int count FROM jobs WHERE state='NEEDS_ATTENTION'")]);
  return {customers:c.rows[0].count,activeServices:s.rows[0].count,onlineRouters:r.rows[0].count,orders:o.rows[0].count,revenueMinor:Number(p.rows[0].total),attentionJobs:j.rows[0].count}; });
 admin.get('/customers',async(req:any)=>{requirePermission(req,'customers:read'); const q=String(req.query?.q||''); return (await db(`SELECT id,public_code,full_name,email,mobile_phone,city,status,created_at FROM customers WHERE status<>'DELETED' AND ($1='' OR full_name ILIKE '%'||$1||'%' OR email ILIKE '%'||$1||'%' OR public_code ILIKE '%'||$1||'%') ORDER BY created_at DESC LIMIT 100`,[q])).rows;});
 admin.post('/customers',async(req:any,reply)=>{requirePermission(req,'customers:write'); requireCsrf(req); const b=req.body||{}; const r=await db(`INSERT INTO customers(full_name,email,mobile_phone,address_line,city,governorate,status,password_hash) VALUES($1,$2,$3,$4,$5,$6,'INVITED',NULL) RETURNING *`,[b.fullName,b.email,b.mobilePhone,b.addressLine||'',b.city||'',b.governorate||null]); return reply.code(201).send(r.rows[0]);});
 admin.patch('/customers/:id',async(req:any)=>{requirePermission(req,'customers:write');requireCsrf(req);const b=req.body||{};const r=await db(`UPDATE customers SET full_name=COALESCE($1,full_name),mobile_phone=COALESCE($2,mobile_phone),address_line=COALESCE($3,address_line),city=COALESCE($4,city),governorate=COALESCE($5,governorate),status=COALESCE($6,status),updated_at=now() WHERE id=$7 AND status<>'DELETED' RETURNING *`,[b.fullName,b.mobilePhone,b.addressLine,b.city,b.governorate,b.status,req.params.id]);if(!r.rowCount)throw Object.assign(new Error('Not found'),{statusCode:404});return r.rows[0];});
 admin.get('/services',async(req:any)=>{requirePermission(req,'services:read');return (await db(`SELECT s.id,s.public_code,s.label,s.status,s.created_at,c.name category,c.protocol,sub.status subscription_status,sub.current_period_end,sub.used_bytes,sub.quota_bytes,cu.public_code customer_code,cu.full_name customer_name,h.city,h.country,se.public_code endpoint_code FROM services s JOIN customers cu ON cu.id=s.customer_id JOIN config_categories c ON c.id=s.category_id LEFT JOIN subscriptions sub ON sub.service_id=s.id LEFT JOIN service_allocations sa ON sa.service_id=s.id AND sa.status='ACTIVE' LEFT JOIN server_endpoints se ON se.id=sa.endpoint_id LEFT JOIN hosts h ON h.id=se.host_id ORDER BY s.created_at DESC LIMIT 200`)).rows;});
 admin.post('/services/:id/action',async(req:any)=>{requirePermission(req,'services:write');requireCsrf(req);const action=req.body?.action;const id=req.params.id;const client=await pool.connect();try{await client.query('BEGIN');let status:string|undefined;if(action==='suspend')status='SUSPENDED';if(action==='resume')status='ACTIVE';if(action==='terminate')status='TERMINATED';if(action==='retry')status='PROVISIONING';if(!status)throw Object.assign(new Error('Unsupported action'),{statusCode:400});const r=await client.query('UPDATE services SET status=$1,updated_at=now() WHERE id=$2 RETURNING *',[status,id]);if(!r.rowCount)throw Object.assign(new Error('Not found'),{statusCode:404});await client.query(`INSERT INTO jobs(type,key,subject_type,subject_id,payload) VALUES($1,$2,'SERVICE',$3,$4) ON CONFLICT(key) DO NOTHING`,[action,'service:'+id+':'+action+':'+Date.now(),id,JSON.stringify({action})]);await audit(client,req,'service.'+action,'services',id,{});await client.query('COMMIT');return r.rows[0];}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}});
 admin.get('/routers',async(req:any)=>{requirePermission(req,'routers:read');return (await db(`SELECT r.*,c.public_code customer_code,c.full_name customer_name FROM routers r LEFT JOIN customers c ON c.id=r.customer_id ORDER BY r.created_at DESC LIMIT 200`)).rows;});
 admin.post('/routers',async(req:any)=>{requirePermission(req,'routers:write');requireCsrf(req);const b=req.body||{};return (await db(`INSERT INTO routers(serial_number,device_identifier,model,hardware_revision,openwrt_version,firmware_version,lifecycle_status) VALUES($1,$2,$3,$4,$5,$6,'IN_STOCK') RETURNING *`,[b.serialNumber,b.deviceIdentifier||null,b.model,b.hardwareRevision||null,b.openwrtVersion||null,b.firmwareVersion||null])).rows[0];});
 admin.post('/routers/:id/action',async(req:any)=>{requirePermission(req,'routers:write');requireCsrf(req);const map:any={assign:'ASSIGNED',provision:'PROVISIONING',ready:'READY',replace:'REPLACED',decommission:'DECOMMISSIONED',unassign:'IN_STOCK'};const next=map[req.body?.action];if(!next)throw Object.assign(new Error('Unsupported action'),{statusCode:400});const r=await db('UPDATE routers SET lifecycle_status=$1,updated_at=now() WHERE id=$2 RETURNING *',[next,req.params.id]);if(!r.rowCount)throw Object.assign(new Error('Not found'),{statusCode:404});return r.rows[0];});
 admin.get('/servers',async(req:Req)=>{requirePermission(req,'servers:read');return (await db(`SELECT h.*,p.name provider_name,count(se.id)::int endpoint_count,coalesce(sum(se.allocated_count),0)::int allocations FROM hosts h JOIN provider_instances p ON p.id=h.provider_instance_id LEFT JOIN server_endpoints se ON se.host_id=h.id GROUP BY h.id,p.name ORDER BY h.created_at DESC`)).rows;});
 admin.post('/servers/hosts',async(req:any)=>{requirePermission(req,'servers:write');requireCsrf(req);const b=req.body||{};const p=await db('SELECT id FROM provider_instances WHERE id=$1',[b.providerInstanceId]);if(!p.rowCount)throw Object.assign(new Error('Provider not found'),{statusCode:400});return (await db(`INSERT INTO hosts(name,address,country,city,hosting_provider,provider_instance_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[b.name,b.address,b.country||'EG',b.city||null,b.hostingProvider||null,b.providerInstanceId])).rows[0];});
 admin.post('/servers/endpoints',async(req:any)=>{requirePermission(req,'servers:write');requireCsrf(req);const b=req.body||{};return (await db(`INSERT INTO server_endpoints(host_id,name,port,protocol,transport,security,provider_inbound_tag,max_services,public_params) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[b.hostId,b.name,b.port,b.protocol,b.transport||'tcp',b.security||'none',b.providerInboundTag,b.maxServices||100,b.publicParams||{}])).rows[0];});
 admin.get('/catalog',async(req:Req)=>{requirePermission(req,'catalog:read');return {categories:(await db('SELECT * FROM config_categories ORDER BY display_order,name')).rows,plans:(await db('SELECT p.*,c.name category_name,c.protocol FROM config_plans p JOIN config_categories c ON c.id=p.category_id ORDER BY p.created_at DESC')).rows,routerProducts:(await db('SELECT * FROM router_products ORDER BY created_at DESC')).rows};});
 admin.post('/catalog/categories',async(req:any)=>{requirePermission(req,'catalog:write');requireCsrf(req);const b=req.body||{};return (await db(`INSERT INTO config_categories(name,slug,description,protocol,router_compatible,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[b.name,b.slug,b.description||null,b.protocol,b.routerCompatible!==false,b.status||'DRAFT'])).rows[0];});
 admin.post('/catalog/plans',async(req:any)=>{requirePermission(req,'catalog:write');requireCsrf(req);const b=req.body||{};return (await db(`INSERT INTO config_plans(category_id,name,duration_days,price_minor,currency,quota_bytes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[b.categoryId,b.name,b.durationDays,b.priceMinor,b.currency||'EGP',b.quotaBytes||null])).rows[0];});
 admin.post('/catalog/router-products',async(req:any)=>{requirePermission(req,'catalog:write');requireCsrf(req);const b=req.body||{};return (await db(`INSERT INTO router_products(sku,name,model,price_minor,currency) VALUES($1,$2,$3,$4,$5) RETURNING *`,[b.sku,b.name,b.model,b.priceMinor,b.currency||'EGP'])).rows[0];});
 admin.get('/orders',async(req:Req)=>{requirePermission(req,'orders:read');return (await db(`SELECT o.*,c.public_code customer_code,c.full_name customer_name,(SELECT count(*) FROM order_items oi WHERE oi.order_id=o.id)::int item_count FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.created_at DESC LIMIT 200`)).rows;});
 admin.post('/orders/:id/cancel',async(req:any)=>{requirePermission(req,'orders:write');requireCsrf(req);return (await db(`UPDATE orders SET status='CANCELLED',cancelled_at=now(),updated_at=now() WHERE id=$1 AND status IN ('PENDING_PAYMENT','FULFILLING') RETURNING *`,[req.params.id])).rows[0]||null;});
 admin.get('/payments',async(req:Req)=>{requirePermission(req,'payments:read');return (await db(`SELECT p.*,o.public_code order_code,c.full_name customer_name FROM payments p JOIN orders o ON o.id=p.order_id JOIN customers c ON c.id=o.customer_id ORDER BY p.created_at DESC LIMIT 200`)).rows;});
 admin.post('/payments/manual',async(req:any)=>{requirePermission(req,'payments:write');requireCsrf(req);const b=(req as any).body||{};const client=await pool.connect();try{await client.query('BEGIN');const o=await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[b.orderId]);if(!o.rowCount)throw Object.assign(new Error('Order not found'),{statusCode:404});if(Number(b.amountMinor)!==Number(o.rows[0].total_minor))throw Object.assign(new Error('Amount mismatch'),{statusCode:400});const pay=await client.query(`INSERT INTO payments(order_id,gateway,method,amount_minor,currency,status,recorded_by_staff_id,paid_at) VALUES($1,'manual',$2,$3,$4,'SUCCEEDED',$5,now()) RETURNING *`,[b.orderId,b.method||'bank_transfer',b.amountMinor,o.rows[0].currency,req.principal!.id]);await client.query(`UPDATE orders SET status='PAID',paid_at=now(),updated_at=now() WHERE id=$1`,[b.orderId]);await client.query(`INSERT INTO jobs(type,key,subject_type,subject_id,payload) SELECT 'fulfill_order',$1,'ORDER',o.id,$2 FROM orders o WHERE o.id=$3 ON CONFLICT(key) DO NOTHING`,['fulfill:'+b.orderId,JSON.stringify({orderId:b.orderId}),b.orderId]);await audit(client,req,'payment.recorded','payments',pay.rows[0].id,{gateway:'manual'},o.rows[0].customer_id);await client.query('COMMIT');return pay.rows[0];}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}});
 admin.get('/jobs',async(req:Req)=>{requirePermission(req,'jobs:read');return (await db('SELECT * FROM jobs ORDER BY CASE state WHEN \'NEEDS_ATTENTION\' THEN 0 WHEN \'RUNNING\' THEN 1 ELSE 2 END,run_at DESC LIMIT 300')).rows;});
 admin.post('/jobs/:id/retry',async(req:any)=>{requirePermission(req,'jobs:write');requireCsrf(req);return (await db(`UPDATE jobs SET state='QUEUED',run_at=now(),last_error=NULL,locked_at=NULL,locked_by=NULL,updated_at=now() WHERE id=$1 AND state='NEEDS_ATTENTION' RETURNING *`,[req.params.id])).rows[0]||null;});
 admin.get('/audit-logs',async(req:any)=>{requirePermission(req,'audit:read');const q=String(req.query?.q||'');return (await db(`SELECT * FROM audit_logs WHERE $1='' OR action ILIKE '%'||$1||'%' OR entity_type ILIKE '%'||$1||'%' ORDER BY occurred_at DESC LIMIT 300`,[q])).rows;});
 admin.get('/provider-instances',async(req:Req)=>{requirePermission(req,'providers:read');return (await db('SELECT id,type,name,base_url,api_version,status,last_ok_at FROM provider_instances ORDER BY name')).rows;});
 admin.get('/staff-users',async(req:Req)=>{requirePermission(req,'*');return (await db('SELECT id,email,full_name,role,status,totp_enabled,last_login_at,created_at FROM staff_users ORDER BY created_at')).rows;});
 admin.get('/settings',async(req:Req)=>{requirePermission(req,'*');return (await db('SELECT key,value,updated_at FROM app_settings ORDER BY key')).rows;});
}, { prefix:'/api/v1/admin' });

app.register(async customer=>{
 customer.addHook('preHandler',async(req:Req)=>{if(!req.principal||req.principal.type!=='CUSTOMER')throw Object.assign(new Error('Customer authentication required'),{statusCode:401})});
 customer.get('/profile',async(req:Req)=>{return (await db('SELECT id,public_code,full_name,email,mobile_phone,address_line,city,governorate,status FROM customers WHERE id=$1 AND status<>\'DELETED\'',[req.principal!.id])).rows[0]||null});
 customer.patch('/profile',async(req:any)=>{requireCsrf(req);const b=req.body||{};return (await db('UPDATE customers SET full_name=COALESCE($1,full_name),mobile_phone=COALESCE($2,mobile_phone),address_line=COALESCE($3,address_line),city=COALESCE($4,city),governorate=COALESCE($5,governorate),updated_at=now() WHERE id=$6 RETURNING id,public_code,full_name,email,mobile_phone,address_line,city,governorate,status',[b.fullName,b.mobilePhone,b.addressLine,b.city,b.governorate,req.principal!.id])).rows[0]});
 customer.get('/catalog/categories',async()=>{return (await db(`SELECT c.id,c.name,c.slug,c.description,c.protocol,c.router_compatible,c.link_visibility,json_agg(json_build_object('id',p.id,'name',p.name,'durationDays',p.duration_days,'priceMinor',p.price_minor,'currency',p.currency,'quotaBytes',p.quota_bytes) ORDER BY p.duration_days) FILTER(WHERE p.id IS NOT NULL) plans FROM config_categories c LEFT JOIN config_plans p ON p.category_id=c.id AND p.status='ACTIVE' WHERE c.status='ACTIVE' GROUP BY c.id ORDER BY c.display_order,c.name`)).rows});
 customer.get('/services',async(req:Req)=>{return (await db(`SELECT s.id,s.public_code,s.label,c.name category_name,s.status,sub.status subscription_status,sub.starts_at,sub.current_period_end,sub.used_bytes,sub.quota_bytes,r.public_code router_code,r.model router_model,r.connectivity router_connectivity,h.city,h.country FROM services s JOIN config_categories c ON c.id=s.category_id LEFT JOIN subscriptions sub ON sub.service_id=s.id LEFT JOIN routers r ON r.id=s.router_id LEFT JOIN service_allocations a ON a.service_id=s.id AND a.status='ACTIVE' LEFT JOIN server_endpoints e ON e.id=a.endpoint_id LEFT JOIN hosts h ON h.id=e.host_id WHERE s.customer_id=$1 ORDER BY s.created_at DESC`,[req.principal!.id])).rows});
 customer.get('/services/:id',async(req:Req)=>{return (await db(`SELECT s.id,s.public_code,s.label,c.name category_name,s.status,sub.status subscription_status,sub.starts_at,sub.current_period_end,sub.used_bytes,sub.quota_bytes,r.public_code router_code,r.model router_model,r.connectivity router_connectivity,h.city,h.country FROM services s JOIN config_categories c ON c.id=s.category_id LEFT JOIN subscriptions sub ON sub.service_id=s.id LEFT JOIN routers r ON r.id=s.router_id LEFT JOIN service_allocations a ON a.service_id=s.id AND a.status='ACTIVE' LEFT JOIN server_endpoints e ON e.id=a.endpoint_id LEFT JOIN hosts h ON h.id=e.host_id WHERE s.id=$1 AND s.customer_id=$2`,[req.params.id,req.principal!.id])).rows[0]||null});
 customer.get('/services/:id/config',async(req:Req)=>{const r=await db(`SELECT s.id,c.link_visibility,cfg.protocol,cfg.transport,cfg.security,cfg.client_credential_enc,cfg.params,e.port,h.address FROM services s JOIN config_categories c ON c.id=s.category_id JOIN configs cfg ON cfg.service_id=s.id AND cfg.status='CURRENT' JOIN service_allocations a ON a.service_id=s.id AND a.status='ACTIVE' JOIN server_endpoints e ON e.id=a.endpoint_id JOIN hosts h ON h.id=e.host_id WHERE s.id=$1 AND s.customer_id=$2`,[req.params.id,req.principal!.id]);if(!r.rowCount)throw Object.assign(new Error('Not found'),{statusCode:404});const row=r.rows[0];if(row.link_visibility==='NEVER'||(row.link_visibility==='STANDALONE_ONLY' && (await db('SELECT router_id FROM services WHERE id=$1',[req.params.id])).rows[0].router_id))throw Object.assign(new Error('Config is not available for this service'),{statusCode:403});let uuid=decryptSecret(row.client_credential_enc);let link='';if(row.protocol==='vless'){const q=new URLSearchParams();if(row.transport)q.set('type',row.transport);if(row.security)q.set('security',row.security);if(row.params?.sni)q.set('sni',row.params.sni);if(row.params?.path)q.set('path',row.params.path);if(row.params?.host)q.set('host',row.params.host);if(row.params?.flow)q.set('flow',row.params.flow);link=`vless://${encodeURIComponent(uuid)}@${row.address}:${row.port}?${q.toString()}#CowboyBebop`;}else{const payload=Buffer.from(JSON.stringify({v:2,ps:'CowboyBebop',add:row.address,port:String(row.port),id:uuid,aid:0,net:row.transport||'tcp',type:'none',host:row.params?.host||'',path:row.params?.path||'',tls:row.security==='tls'?'tls':''})).toString('base64');link=`vmess://${payload}`;}const client=await pool.connect();try{await audit(client,req,'secret.revealed','configs',null,{serviceId:req.params.id},req.principal!.id); }finally{client.release();}return {link};});
 customer.post('/services/:id/renew',async(req:Req)=>{requireCsrf(req);const service=await db(`SELECT s.*,p.id plan_id,p.name plan_name,p.duration_days,p.price_minor,p.currency FROM services s JOIN config_plans p ON p.id=s.plan_id WHERE s.id=$1 AND s.customer_id=$2`,[req.params.id,req.principal!.id]);if(!service.rowCount)throw Object.assign(new Error('Not found'),{statusCode:404});const x=service.rows[0];const client=await pool.connect();try{await client.query('BEGIN');const o=await client.query(`INSERT INTO orders(customer_id,status,currency,subtotal_minor,total_minor,idempotency_key) VALUES($1,'PENDING_PAYMENT',$2,$3,$3,$4) RETURNING *`,[req.principal!.id,x.currency,x.price_minor,'renew:'+req.params.id+':'+Date.now()]);await client.query(`INSERT INTO order_items(order_id,item_type,plan_id,target_service_id,name_snapshot,unit_price_minor) VALUES($1,'CONFIG_RENEWAL',$2,$3,$4,$5)`,[o.rows[0].id,x.plan_id,req.params.id,x.plan_name,x.price_minor]);await client.query('COMMIT');return o.rows[0];}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}});
 customer.get('/routers',async(req:Req)=>{return (await db(`SELECT r.public_code,r.model,r.firmware_version,r.connectivity,r.lifecycle_status,r.last_seen_at,r.notes,(SELECT s.public_code FROM services s WHERE s.router_id=r.id AND s.status IN ('PROVISIONING','ACTIVE','SUSPENDED') LIMIT 1) assigned_service FROM routers r WHERE r.customer_id=$1 ORDER BY r.created_at DESC`,[req.principal!.id])).rows});
 customer.post('/routers/:id/replacement-requests',async(req:any)=>{requireCsrf(req);const b=req.body||{};const r=await db(`INSERT INTO router_replacements(customer_id,old_router_id,reason,rotate_credentials,requested_by_type,requested_by_id) SELECT $1,id,$2,COALESCE($3,true),'CUSTOMER',$1 FROM routers WHERE id=$4 AND customer_id=$1 RETURNING *`,[req.principal!.id,b.reason||'Customer requested replacement',b.rotateCredentials,req.params.id]);if(!r.rowCount)throw Object.assign(new Error('Not found'),{statusCode:404});return r.rows[0]});
 customer.get('/orders',async(req:Req)=>{return (await db(`SELECT o.id,o.public_code,o.status,o.currency,o.subtotal_minor,o.total_minor,o.placed_at,o.paid_at,json_agg(json_build_object('name',oi.name_snapshot,'type',oi.item_type,'priceMinor',oi.unit_price_minor,'status',oi.fulfillment_status)) items FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.customer_id=$1 GROUP BY o.id ORDER BY o.created_at DESC`,[req.principal!.id])).rows});
 customer.post('/orders',async(req:any)=>{requireCsrf(req);const key=req.headers['idempotency-key'];if(typeof key!=='string'||!key)throw Object.assign(new Error('Idempotency-Key required'),{statusCode:400});const items=Array.isArray(req.body?.items)?req.body.items:[];if(!items.length)throw Object.assign(new Error('Order is empty'),{statusCode:400});const client=await pool.connect();try{await client.query('BEGIN');const existing=await client.query('SELECT * FROM orders WHERE customer_id=$1 AND idempotency_key=$2',[req.principal!.id,key]);if(existing.rowCount){await client.query('ROLLBACK');return existing.rows[0];}let subtotal=0;const resolved:any[]=[];for(const item of items){if(item.type==='CONFIG_NEW'){const p=await client.query('SELECT p.*,c.name category_name FROM config_plans p JOIN config_categories c ON c.id=p.category_id WHERE p.id=$1 AND p.status=\'ACTIVE\'',[item.planId]);if(!p.rowCount)throw Object.assign(new Error('Plan not found'),{statusCode:400});subtotal+=Number(p.rows[0].price_minor);resolved.push({type:'CONFIG_NEW',planId:item.planId,name:p.rows[0].category_name+' - '+p.rows[0].name,price:Number(p.rows[0].price_minor),useWithRouter:Boolean(item.useWithRouter)});}else if(item.type==='ROUTER'){const p=await client.query('SELECT * FROM router_products WHERE id=$1 AND status=\'ACTIVE\'',[item.routerProductId]);if(!p.rowCount)throw Object.assign(new Error('Router product not found'),{statusCode:400});subtotal+=Number(p.rows[0].price_minor);resolved.push({type:'ROUTER',routerProductId:item.routerProductId,name:p.rows[0].name,price:Number(p.rows[0].price_minor)});}else throw Object.assign(new Error('Unsupported order item'),{statusCode:400});}
 const o=await client.query(`INSERT INTO orders(customer_id,status,subtotal_minor,total_minor,idempotency_key) VALUES($1,'PENDING_PAYMENT',$2,$2,$3) RETURNING *`,[req.principal!.id,subtotal,key]);for(const item of resolved)await client.query(`INSERT INTO order_items(order_id,item_type,router_product_id,plan_id,use_with_router,name_snapshot,unit_price_minor) VALUES($1,$2,$3,$4,$5,$6,$7)`,[o.rows[0].id,item.type,item.routerProductId||null,item.planId||null,item.useWithRouter||false,item.name,item.price]);await client.query('COMMIT');return o.rows[0];}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}});
 customer.post('/orders/:id/pay',async(req:Req)=>{requireCsrf(req);const r=await db(`INSERT INTO payments(order_id,gateway,method,amount_minor,currency,status) SELECT id,'manual','pending',total_minor,currency,'INITIATED' FROM orders WHERE id=$1 AND customer_id=$2 AND status='PENDING_PAYMENT' RETURNING *`,[req.params.id,req.principal!.id]);if(!r.rowCount)throw Object.assign(new Error('Order not payable'),{statusCode:400});return {payment:r.rows[0],message:'تم إنشاء طلب الدفع؛ سجّل الدفع يدويًا من لوحة الإدارة عند استلام التحويل.'};});
}, {prefix:'/api/v1/customer'});

app.post('/api/v1/webhooks/payments/:gateway',async(req:any)=>{const signature=req.headers['x-webhook-signature'];const secret=process.env[`WEBHOOK_SECRET_${String(req.params.gateway).toUpperCase()}`];if(secret && signature!==crypto.createHmac('sha256',secret).update(JSON.stringify(req.body)).digest('hex'))throw Object.assign(new Error('Invalid signature'),{statusCode:401});const eventId=String(req.headers['x-event-id']||req.body?.id||'');if(!eventId)throw Object.assign(new Error('Missing event id'),{statusCode:400});const client=await pool.connect();try{await client.query('BEGIN');const e=await client.query('INSERT INTO payment_events(gateway,event_id,payload) VALUES($1,$2,$3) ON CONFLICT(gateway,event_id) DO NOTHING RETURNING id',[req.params.gateway,eventId,req.body||{}]);if(!e.rowCount){await client.query('ROLLBACK');return {ok:true,duplicate:true};}const paymentId=req.body?.paymentId||req.body?.payment_id;const status=req.body?.status==='succeeded'?'SUCCEEDED':'FAILED';if(paymentId){await client.query('UPDATE payments SET status=$1,paid_at=CASE WHEN $1=\'SUCCEEDED\' THEN now() ELSE paid_at END,updated_at=now() WHERE id=$2',[status,paymentId]);if(status==='SUCCEEDED')await client.query(`UPDATE orders SET status='PAID',paid_at=now(),updated_at=now() WHERE id=(SELECT order_id FROM payments WHERE id=$1)`,[paymentId]);}await client.query('UPDATE payment_events SET payment_id=$1,processed_at=now(),result=$2 WHERE id=$3',[paymentId,status,e.rows[0].id]);await client.query('COMMIT');return {ok:true};}catch(err){await client.query('ROLLBACK');throw err}finally{client.release()}});

async function main(){await db('SELECT 1');await seed();await app.listen({port:PORT,host:'0.0.0.0'});app.log.info(`API listening on ${PORT}`);}
main().catch(err=>{app.log.error(err);process.exit(1)});
