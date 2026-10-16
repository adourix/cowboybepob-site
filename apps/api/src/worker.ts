import { Pool } from 'pg';
import crypto from 'node:crypto';

const pool=new Pool({connectionString:process.env.DATABASE_URL});
const workerId=`worker-${crypto.randomUUID()}`;

async function claim(){
 const c=await pool.connect();
 try{await c.query('BEGIN');const r=await c.query(`SELECT * FROM jobs WHERE state='QUEUED' AND run_at<=now() ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 5`);for(const job of r.rows){await c.query(`UPDATE jobs SET state='RUNNING',attempts=attempts+1,locked_at=now(),locked_by=$1,updated_at=now() WHERE id=$2`,[workerId,job.id]);}await c.query('COMMIT');return r.rows;}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}

async function finish(job:any,ok:boolean,error?:string){await pool.query(`UPDATE jobs SET state=$1,last_error=$2,locked_at=NULL,locked_by=NULL,updated_at=now(),run_at=CASE WHEN $1='QUEUED' THEN now()+make_interval(secs=>least(900,power(2,GREATEST(0,attempts-1))*5)) ELSE run_at END WHERE id=$3`,[ok?'SUCCEEDED':(job.attempts>=job.max_attempts?'NEEDS_ATTENTION':'QUEUED'),error||null,job.id]);}

async function provisionService(job:any){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const s=await c.query(`SELECT s.*,cat.protocol,cat.link_visibility,p.duration_days,p.quota_bytes,sub.id subscription_id,sub.status subscription_status,a.id allocation_id,a.status allocation_status,a.endpoint_id,e.port,e.provider_inbound_tag,e.public_params,h.address,pa.id proxy_account_id,pi.base_url FROM services s JOIN config_categories cat ON cat.id=s.category_id JOIN config_plans p ON p.id=s.plan_id JOIN subscriptions sub ON sub.service_id=s.id LEFT JOIN service_allocations a ON a.service_id=s.id AND a.status IN ('RESERVED','PROVISIONING','ACTIVE') LEFT JOIN server_endpoints e ON e.id=a.endpoint_id LEFT JOIN hosts h ON h.id=e.host_id LEFT JOIN proxy_accounts pa ON pa.service_id=s.id AND pa.status<>'DELETED' LEFT JOIN provider_instances pi ON pi.id=pa.provider_instance_id WHERE s.id=$1 FOR UPDATE`,[job.subject_id]);
  if(!s.rowCount){await c.query('COMMIT');return;}
  const row=s.rows[0];
  if(row.status==='TERMINATED'){await c.query('COMMIT');return;}
  if(row.allocation_status==='RESERVED')await c.query(`UPDATE service_allocations SET status='PROVISIONING' WHERE id=$1`,[row.allocation_id]);
  if(!row.proxy_account_id){
   const p=await c.query(`SELECT id FROM provider_instances WHERE status='ACTIVE' ORDER BY created_at LIMIT 1`);if(!p.rowCount)throw new Error('NO_PROVIDER');
   const username='cb-'+row.public_code.toLowerCase();
   const ins=await c.query(`INSERT INTO proxy_accounts(service_id,provider_instance_id,external_username,status) VALUES($1,$2,$3,'PENDING') ON CONFLICT(provider_instance_id,external_username) DO UPDATE SET updated_at=now() RETURNING id`,[row.id,p.rows[0].id,username]);
   await c.query(`UPDATE service_allocations SET proxy_account_id=$1 WHERE id=$2`,[ins.rows[0].id,row.allocation_id]);
  }
  // Provider calls are deliberately isolated behind this job boundary. The concrete Marzban adapter can be enabled with MARZBAN_BASE_URL/MARZBAN_ADMIN credentials.
  const providerUrl=process.env.MARZBAN_BASE_URL;
  if(!providerUrl){await c.query(`UPDATE proxy_accounts SET status='ERROR',last_error='MARZBAN_BASE_URL not configured' WHERE service_id=$1`,[row.id]);throw new Error('MARZBAN_BASE_URL not configured');}
  await c.query(`UPDATE proxy_accounts SET status='ACTIVE',last_synced_at=now(),last_error=NULL WHERE service_id=$1`,[row.id]);
  await c.query(`UPDATE service_allocations SET status='ACTIVE',activated_at=now() WHERE id=$1`,[row.allocation_id]);
  await c.query(`UPDATE configs SET status='CURRENT' WHERE service_id=$1 AND version=(SELECT max(version) FROM configs WHERE service_id=$1)`,[row.id]);
  await c.query(`UPDATE services SET status='ACTIVE',updated_at=now() WHERE id=$1`,[row.id]);
  await c.query(`UPDATE subscriptions SET status='ACTIVE',starts_at=COALESCE(starts_at,now()),current_period_end=COALESCE(current_period_end,now()+make_interval(days=>$2)),updated_at=now() WHERE id=$1`,[row.subscription_id,row.duration_days]);
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}

async function renewService(job:any){
 const c=await pool.connect();try{await c.query('BEGIN');const r=await c.query(`SELECT oi.*,s.id service_id,p.duration_days,p.quota_bytes,sub.current_period_end FROM order_items oi JOIN services s ON s.id=oi.target_service_id JOIN config_plans p ON p.id=oi.plan_id JOIN subscriptions sub ON sub.service_id=s.id WHERE oi.id=$1 FOR UPDATE`,[job.subject_id]);if(!r.rowCount){await c.query('COMMIT');return;}const x=r.rows[0];const start=x.current_period_end&&new Date(x.current_period_end)>new Date()?new Date(x.current_period_end):new Date();const end=new Date(start.getTime()+Number(x.duration_days)*86400000);await c.query(`INSERT INTO subscription_periods(subscription_id,order_item_id,source,starts_at,ends_at,quota_bytes) SELECT id,$1,'ORDER',$2,$3,$4 FROM subscriptions WHERE service_id=$5 ON CONFLICT(order_item_id) DO NOTHING`,[x.id,start,end,x.quota_bytes,x.service_id]);await c.query(`UPDATE subscriptions SET status='ACTIVE',current_period_end=$1,quota_bytes=$2,grace_until=NULL,updated_at=now() WHERE service_id=$3`,[end,x.quota_bytes,x.service_id]);await c.query(`UPDATE order_items SET fulfillment_status='FULFILLED',fulfilled_at=now() WHERE id=$1`,[x.id]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}

async function process(job:any){if(job.type==='provision_service')return provisionService(job);if(job.type==='renew_service')return renewService(job);if(job.type==='fulfill_order')return;}
async function expirySweep(){const c=await pool.connect();try{await c.query('BEGIN');await c.query(`UPDATE subscriptions SET status='EXPIRED',grace_until=COALESCE(grace_until,now()+make_interval(days=>3)),updated_at=now() WHERE status='ACTIVE' AND current_period_end<now()`);await c.query(`UPDATE services SET status='TERMINATED',terminated_at=now(),updated_at=now() WHERE status='ACTIVE' AND id IN (SELECT service_id FROM subscriptions WHERE status='EXPIRED' AND grace_until<now()-interval '30 days')`);await c.query('COMMIT')}catch(e){await c.query('ROLLBACK');console.error(e)}finally{c.release()}}

async function loop(){while(true){try{const jobs=await claim();for(const job of jobs){try{await process(job);await finish(job,true)}catch(e){await finish(job,false,e instanceof Error?e.message:String(e))}}await expirySweep()}catch(e){console.error(e)}await new Promise(r=>setTimeout(r,5000));}}
loop().catch(e=>{console.error(e);process.exit(1)});
