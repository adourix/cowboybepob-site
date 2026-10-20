import { Pool } from 'pg';
import crypto from 'node:crypto';

export type MarzbanUser = {
  username: string;
  status?: string;
  expire?: number;
  data_limit?: number;
  used_traffic?: number;
  subscription_url?: string;
  links?: string[];
  proxies?: Record<string, unknown>;
  inbounds?: Record<string, string[]>;
};

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
  serverName?: string | string[];
  host?: string | string[];
  path?: string;
  serviceName?: string;
  grpcServiceName?: string;
  pbk?: string;
  publicKey?: string;
  sid?: string | string[];
  shortId?: string | string[];
  shortIds?: string[];
  spx?: string;
  spiderX?: string;
  fp?: string;
  fingerprint?: string;
  alpn?: string | string[];
  [key: string]: unknown;
};

type ProviderSecret = { username: string; password: string };

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const encryptionKey = process.env.ENCRYPTION_KEY || '';
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.MARZBAN_REQUEST_TIMEOUT_MS || 15000));

function decryptSecret(value: Buffer) {
  if (!encryptionKey) throw new Error('ENCRYPTION_KEY_NOT_CONFIGURED');
  if (value.length < 28) throw new Error('MARZBAN_PROVIDER_CREDENTIALS_INVALID');
  const key = crypto.createHash('sha256').update(encryptionKey).digest();
  const iv = value.subarray(0, 12);
  const tag = value.subarray(12, 28);
  const data = value.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function isLocalProviderAlias(hostname: string) {
  const h = hostname.toLowerCase();
  return h === 'marzban' || h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

async function resolveProviderSecret(baseUrl: string, username?: string, password?: string, providerId?: string): Promise<ProviderSecret> {
  if (username && password) return { username, password };
  const r = providerId
    ? await pool.query(`SELECT credentials_enc FROM provider_instances WHERE id=$1 AND status='ACTIVE'`, [providerId])
    : await pool.query(`SELECT credentials_enc FROM provider_instances WHERE base_url=$1 AND status='ACTIVE' ORDER BY created_at LIMIT 1`, [baseUrl]);
  if (!r.rowCount || !r.rows[0].credentials_enc) throw new Error(`MARZBAN_PROVIDER_CREDENTIALS_NOT_CONFIGURED:${baseUrl}`);
  try {
    const parsed = JSON.parse(decryptSecret(r.rows[0].credentials_enc)) as ProviderSecret;
    if (!parsed.username || !parsed.password) throw new Error('invalid');
    return parsed;
  } catch {
    throw new Error(`MARZBAN_PROVIDER_CREDENTIALS_INVALID:${baseUrl}`);
  }
}

async function resolveBaseUrl(baseUrl: string, providerId?: string) {
  const raw = String(baseUrl || '').trim().replace(/\/$/, '');
  if (!raw) return raw;
  let u: URL;
  try { u = new URL(raw); } catch { return raw; }
  if (!isLocalProviderAlias(u.hostname)) return raw;

  const r = providerId
    ? await pool.query(`
        SELECT h.address
        FROM hosts h
        WHERE h.provider_instance_id=$1
          AND h.status <> 'DECOMMISSIONED'
        ORDER BY CASE WHEN h.status='ACTIVE' THEN 0 ELSE 1 END, h.created_at
        LIMIT 1
      `, [providerId])
    : await pool.query(`
        SELECT h.address
        FROM hosts h
        JOIN provider_instances p ON p.id=h.provider_instance_id
        WHERE p.base_url=$1
          AND h.status <> 'DECOMMISSIONED'
        ORDER BY CASE WHEN h.status='ACTIVE' THEN 0 ELSE 1 END, h.created_at
        LIMIT 1
      `, [raw]);

  if (!r.rowCount || !r.rows[0].address) return raw;
  u.hostname = String(r.rows[0].address).replace(/^\[|\]$/g, '');
  return u.toString().replace(/\/$/, '');
}

function timeoutSignal(existing: AbortSignal | null | undefined) {
  if (existing) return existing;
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

function flattenInboundResponse(data: any): MarzbanInbound[] {
  if (Array.isArray(data)) return data as MarzbanInbound[];
  for (const key of ['inbounds', 'items', 'data']) {
    if (Array.isArray(data?.[key])) return data[key] as MarzbanInbound[];
  }
  if (data && typeof data === 'object') {
    const flattened: MarzbanInbound[] = [];
    for (const [group, value] of Object.entries(data)) {
      if (!Array.isArray(value)) continue;
      const protocol = group.toLowerCase();
      for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        flattened.push({ ...(item as MarzbanInbound), protocol: String((item as any).protocol || protocol).toLowerCase() });
      }
    }
    if (flattened.length) return flattened;
  }
  return [];
}

export class MarzbanProvider {
  private token = '';
  private tokenExpires = 0;
  private resolved?: ProviderSecret;
  private effectiveUrl?: string;
  private readonly resetUsers = new Set<string>();

  constructor(
    private readonly baseUrl: string,
    private readonly username = '',
    private readonly password = '',
    private readonly providerId?: string,
  ) {}

  private async auth() {
    if (this.token && Date.now() < this.tokenExpires) return;
    this.resolved = this.resolved || await resolveProviderSecret(this.baseUrl, this.username, this.password, this.providerId);
    this.effectiveUrl = this.effectiveUrl || await resolveBaseUrl(this.baseUrl, this.providerId);
    if (!this.effectiveUrl) throw new Error('MARZBAN_BASE_URL_NOT_CONFIGURED');
    const body = new URLSearchParams({ username: this.resolved.username, password: this.resolved.password, grant_type: 'password' });
    const r = await fetch(`${this.effectiveUrl}/api/admin/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!r.ok) { const text = await r.text(); throw Object.assign(new Error(`Marzban authentication failed (${r.status}): ${text.slice(0, 200)}`), { status: r.status }); }
    const data = await r.json() as { access_token?: string };
    if (!data.access_token) throw new Error('Marzban authentication returned no access token');
    this.token = data.access_token;
    this.tokenExpires = Date.now() + 20 * 60 * 1000;
  }

  private async request(path: string, init: RequestInit = {}, retry = true): Promise<any> {
    await this.auth();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    headers.set('accept', 'application/json');
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const r = await fetch(`${this.effectiveUrl}${path}`, { ...init, headers, signal: timeoutSignal(init.signal) });
    if (r.status === 401 && retry) { this.token = ''; this.tokenExpires = 0; return this.request(path, init, false); }
    if (!r.ok) { const text = await r.text(); throw Object.assign(new Error(`Marzban ${r.status}: ${text.slice(0, 500)}`), { status: r.status }); }
    return r.status === 204 ? null : r.json();
  }

  async health() {
    await this.auth();
    return true;
  }

  async getUser(username: string) {
    try { return await this.request(`/api/user/${encodeURIComponent(username)}`) as MarzbanUser; }
    catch (e: any) { if (e?.status === 404) return null; throw e; }
  }

  async createOrUpdate(input: any): Promise<MarzbanUser> {
    const existing = await this.getUser(input.username);
    const expire = Math.floor(new Date(input.expireAt).getTime() / 1000);
    if (existing && Number.isFinite(expire) && Number(existing.expire || 0) !== expire && !this.resetUsers.has(input.username)) {
      await this.resetUserDataUsage(input.username);
    }
    const payload = { username: input.username, proxies: { [input.protocol]: { id: input.uuid, flow: input.flow || '' } }, inbounds: { [input.protocol]: [input.inbound] }, expire, data_limit: Number(input.quotaBytes || 0) };
    if (existing) return await this.request(`/api/user/${encodeURIComponent(input.username)}`, { method: 'PUT', body: JSON.stringify(payload) }) as MarzbanUser;
    return await this.request('/api/user', { method: 'POST', body: JSON.stringify(payload) }) as MarzbanUser;
  }

  async resetUserDataUsage(username: string) {
    await this.request(`/api/user/${encodeURIComponent(username)}/reset`, { method: 'POST' });
    this.resetUsers.add(username);
    await pool.query(`
      UPDATE subscriptions
      SET used_bytes=0, updated_at=now()
      WHERE id IN (
        SELECT sub.id
        FROM subscriptions sub
        JOIN proxy_accounts pa ON pa.service_id=sub.service_id
        WHERE pa.external_username=$1
          AND pa.status<>'DELETED'
      )
    `, [username]);
  }

  async listInbounds(): Promise<MarzbanInbound[]> {
    return flattenInboundResponse(await this.request('/api/inbounds'));
  }

  async disable(username: string) { await this.request(`/api/user/${encodeURIComponent(username)}`, { method: 'PUT', body: JSON.stringify({ status: 'disabled' }) }); }
  async enable(username: string) { await this.request(`/api/user/${encodeURIComponent(username)}`, { method: 'PUT', body: JSON.stringify({ status: 'active' }) }); }
  async delete(username: string) { const existing = await this.getUser(username); if (existing) await this.request(`/api/user/${encodeURIComponent(username)}`, { method: 'DELETE' }); }
}