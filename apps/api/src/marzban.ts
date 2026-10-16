export type MarzbanUser = { username:string; status?:string; expire?:number; data_limit?:number; used_traffic?:number; subscription_url?:string; links?:string[]; proxies?:Record<string,unknown>; inbounds?:Record<string,string[]> };

export class MarzbanProvider {
 private token=''; private tokenExpires=0;
 constructor(private readonly baseUrl:string, private readonly username:string, private readonly password:string) {}
 private async auth(){
  if(this.token && Date.now()<this.tokenExpires)return;
  const body=new URLSearchParams({username:this.username,password:this.password,grant_type:'password'});
  const r=await fetch(`${this.baseUrl.replace(/\/$/,'')}/api/admin/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
  if(!r.ok)throw new Error(`Marzban authentication failed (${r.status})`);
  const data=await r.json() as {access_token:string};this.token=data.access_token;this.tokenExpires=Date.now()+20*60*1000;
 }
 private async request(path:string,init:RequestInit={},retry=true):Promise<any>{await this.auth();const headers=new Headers(init.headers);headers.set('Authorization',`Bearer ${this.token}`);headers.set('content-type','application/json');const r=await fetch(`${this.baseUrl.replace(/\/$/,'')}${path}`,{...init,headers});if(r.status===401&&retry){this.token='';return this.request(path,init,false)};if(!r.ok){const text=await r.text();throw Object.assign(new Error(`Marzban ${r.status}: ${text.slice(0,300)}`),{status:r.status})};return r.status===204?null:r.json()}
 async getUser(username:string){try{return await this.request(`/api/user/${encodeURIComponent(username)}`) as MarzbanUser}catch(e:any){if(e.status===404)return null;throw e}}
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
