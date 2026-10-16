import { Pool } from 'pg';
import { MarzbanProvider } from './marzban.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function claim(){const c=await pool.connect();try{await c.query('BEGIN');const r=await c.query(`SELECT * FROM jobs WHERE state='QUEUED' AND run_at<=now() ORDER BY priority DESC,created_at LIMIT 10 FOR UPDATE SKIP LOCKED`);if(r.rowCount)await c.query(`UPDATE jobs SET state='RUNNING',started_at=now(),attempts=attempts+1 WHERE id=ANY($1::uuid[])`,[r.rows.map(x=>x.id)]);await c.query('COMMIT');return r.rows}finally{c.release()}}
async function finish(job:any,ok:boolean,error?:string){await pool.query(`UPDATE jobs SET state=$1,finished_at=now(),last_error=$2 WHERE id=$3`,[ok?'SUCCEEDED':(job.attempts>=5?'NEEDS_ATTENTION':'QUEUED'),error||null,job.id])}
async function processJob(job:any){if(job.type==='fulfill_order')return fulfillOrder(job);if(job.type==='provision_service')return provisionService(job);if(job.type==='renew_service')return renewService(job);if(job.type==='expiry_sweep')return expirySweep()}
async function fulfillOrder(job:any){await pool.query(`UPDATE orders SET status='FULFILLING',updated_at=now() WHERE id=$1`,[job.payload.orderId])}
async function provisionService(job:any){await pool.query(`UPDATE services SET status='ACTIVE',updated_at=now() WHERE id=$1`,[job.payload.serviceId])}
async function renewService(job:any){await pool.query(`UPDATE services SET status='ACTIVE',updated_at=now() WHERE id=$1`,[job.payload.serviceId])}
async function expirySweep(){await pool.query(`UPDATE services SET status='EXPIRED',updated_at=now() WHERE status='ACTIVE' AND expires_at IS NOT NULL AND expires_at<=now()`)}

async function loop(){while(true){try{for(const job of await claim()){try{await processJob(job);await finish(job,true)}catch(e){await finish(job,false,e instanceof Error?e.message:String(e))}}await expirySweep()}catch(e){console.error(e)}await new Promise(r=>setTimeout(r,5000))}}

loop().catch(e=>{console.error(e);process.exit(1)});
