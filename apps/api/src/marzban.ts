import { Pool } from 'pg';
import crypto from 'node:crypto';

export type MarzbanUser = { username:string; status?:string; expire?:number; data_limit?:number; used_traffic?:number; subscription_url?:string; links?:string[]; proxies?:Record<string,unknown>; inbounds?:Record<string,string[]> };
export type MarzbanInbound = {
  tag?: string;
  port?: number;
  protocol?: string;
  listen?: string;
  enable?: boolean;
  network?: string;
  transport?: string;
  security?: string;
  tls?: string;
  sni?: string | string[];
  host?: string | string[];
  path?: string;
  serviceName?: string;
  pbk?: string;
  sid?: string | string[];
  spx?: string;
  [key:string]: unknown;
};
type ProviderSecret = { username:string; password:string };

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const encryptionKey = process.env.ENCRYPTION_KEY || '';

function decryptSecret(value:Buffer){
 if(!encryptionKey) throw new Error('ENCRYPTION_KEY_NOT_CONFIGURED');
 const key=crypto.createHash('sha256').update(encryptionKey).digest();
 const iv=value.subarray(0,12), tag=value.subarray(12,28), data=value.subarray(28);
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);
 decipher.setAuthTag(tag);
 return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');
}

function isLocalProviderAlias(hostname:string){
 const h=hostname.toLowerCase();
 return h==='marzban'||h==='localhost'||h==='127.0.0.1'||h==='::1';
}

async function resolveProviderSecret(baseUrl:string, username?:string, password?:string):Promise<ProviderSecret>{
 if(username && password) return {username,password};
 const r=await pool.query(`SELECT credentials_enc FROM provider_instances WHERE base_url=$1 AND status='ACTIVE' ORDER BY created_at LIMIT 1`,[baseUrl]);
 if(!r.rowCount || !r.rows[0].credentials_enc) throw new Error(`MARZBAN_PROVIDER_CREDENTIALS_NOT_CONFIGURED:${baseUrl}`);
 let parsed:ProviderSecret;
 try { parsed=JSON.parse(decryptSecret(r.rows[0].credentials_enc)) as ProviderSecret; }
 catch { throw new Error(`MARZBAN_PROVIDER_CREDENTIALS_INVALID:${baseUrl}`); }
 if(!parsed.username || !parsed.password) throw new Error(`MARZBAN_PROVIDER_CREDENTIALS_INVALID:${baseUrl}`);
 return parsed;
}

async function resolveBaseUrl(baseUrl:string){
 const raw=String(baseUrl||'').trim().replace(/\/$/,'');
 if(!raw) return raw;
 let u:URL;
 try { u=new URL(raw); } catch { return raw; }
 if(!isLocalProviderAlias(u.hostname)) return raw;
 const r=await pool.query(`
   SELECT h.address
   FROM hosts h
   JOIN provider_instances p ON p.id=h.provider_instance_id
   WHERE p.base_url=$1
     AND h.status <> 'DECOMMISSIONED'
   ORDER BY CASE WHEN h.status='ACTIVE' THEN 0 ELSE 1 END, h.created_at
   LIMIT 1
 `,[raw]);
 if(!r.rowCount || !r.rows[0].address) return raw;
 u.hostname=String(r.rows[0].address).replace(/^\[|\]$/g,'');
 return u.toString().replace(/\/$/,'');
}

export class MarzbanProvider {
 private token=''; private tokenExpires=0; private resolved?:ProviderSecret; private effectiveUrl?:string;
 constructor(private readonly baseUrl:string, private readonly username='', private readonly password='') {}
 private async auth(){
  if(this.token && Date.now()<this.tokenExpires)return;
  this.resolved=this.resolved || await resolveProviderSecret(this.baseUrl,this.username,this.password);
  this.effectiveUrl=this.effectiveUrl || await resolveBaseUrl(this.baseUrl);
  const body=new URLSearchParams({username:this.resolved.username,password:this.resolved.password,grant_type:'password'});
  const r=await fetch(`${this.effectiveUrl}/api/admin/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
  if(!r.ok)throw new Error(`Marzban authentication failed (${r.status})`);
  const data=await r.json() as {access_token:string};
  this.token=data.access_token;
  this.tokenExpires=Date.now()+20*60*1000;
 }
 private async request(path:string,init:RequestInit={},retry=true):Promise<any>{
  await this.auth();
  const headers=new Headers(init.headers);
  headers.set('Authorization',`Bearer ${this.token}`);
  headers.set('content-type','application/json');
  const r=await fetch(`${this.effectiveUrl}${path}`,{...init,headers});
  if(r.status===401&&retry){this.token='';return this.request(path,init,false)}
  if(!r.ok){const text=await r.text();throw Object.assign(new Error(`Marzban ${r.status}: ${text.slice(0,300)}`),{status:r.status})}
  return r.status===204?null:r.json();
 }
 async getUser(username:string){try{return await this.request(`/api/user/${encodeURIComponent(username)}`) as MarzbanUser}catch(e:any){if(e.status===404)return null;throw e}}
 async listInbounds():Promise<MarzbanInbound[]>{
  const data=await this.request('/api/inbounds');
  if(Array.isArray(data)) return data as MarzbanInbound[];
  if(Array.isArray(data?.inbounds)) return data.inbounds as MarzbanInbound[];
  if(Array.isArray(data?.items)) return data.items as MarzbanInbound[];
  if(Array.isArray(data?.data)) return data.data as MarzbanInbound[];
  return [];
 }
 async createOrUpdate(input:{username:string;uuid:string;inbound:string;expireAt:Date;quotaBytes?:number|null;protocol:'vless'|'vmess';flow?:string}){
  const existing=await this.getUser(input.username);
  const proxy=input.protocol==='vless'?{vless:{id:input.uuid,flow:input.flow||''}}:{vmess:{id:input.uuid,alterId:0}};
  const inbounds=input.protocol==='vless'?{vless:[input.inbound]}:{vmess:[input.inbound]};
  const payload={username:input.username,proxies:proxy,inbounds,expire:Math.floor(input.expireAt.getTime()/1000),data_limit:input.quotaBytes||0,data_limit_reset_strategy:'no_reset',status:'active'};
  if(existing){await this.request(`/api/user/${encodeURIComponent(input.username)}`,{method:'PUT',body:JSON.stringify(payload)});return this.getUser(input.username)}
  try{return await this.request('/api/user',{method:'POST',body:JSON.stringify(payload)}) as MarzbanUser}catch(e:any){if(e.status===409)return this.getUser(input.username);throw e}
 }
 async disable(username:string){return this.request(`/api/user/${encodeURIComponent(username)}`,{method:'PUT',body:JSON.stringify({status:'disabled'})})}
 async enable(username:string){return this.request(`/api/user/${encodeURIComponent(username)}`,{method:'PUT',body:JSON.stringify({status:'active'})})}
 async delete(username:string){return this.request(`/api/user/${encodeURIComponent(username)}`,{method:'DELETE'})}
 async usage(username:string){return this.request(`/api/user/${encodeURIComponent(username)}/usage`) as Promise<any>}
 async health(){await this.request('/api/admin');return {ok:true}}
}