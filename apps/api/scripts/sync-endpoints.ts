import { Pool } from 'pg';
import { MarzbanProvider, MarzbanInbound } from '../src/marzban.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const defaultMaxServices = Math.max(1, Number(process.env.MARZBAN_DEFAULT_MAX_SERVICES || 100));

function first(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.length ? String(value[0]) : undefined;
  if (value === undefined || value === null || value === '') return undefined;
  return String(value);
}

function paramsForInbound(inbound: MarzbanInbound) {
  const params: Record<string, unknown> = {};
  const copy = (target: string, ...sources: string[]) => {
    for (const source of sources) {
      const value = inbound[source];
      if (value !== undefined && value !== null && value !== '') {
        params[target] = Array.isArray(value) ? value[0] : value;
        return;
      }
    }
  };
  copy('transport', 'transport', 'network');
  copy('security', 'security', 'tls');
  copy('sni', 'sni', 'serverName');
  copy('host', 'host');
  copy('path', 'path');
  copy('flow', 'flow');
  copy('serviceName', 'serviceName', 'grpcServiceName');
  copy('pbk', 'pbk', 'publicKey');
  copy('sid', 'sid', 'shortId', 'shortIds');
  copy('spx', 'spx', 'spiderX');
  return params;
}

function normalizeInbound(raw: MarzbanInbound) {
  const protocol = String(raw.protocol || '').toLowerCase();
  const tag = first(raw.tag);
  const port = Number(raw.port);
  if (!tag || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (protocol !== 'vless' && protocol !== 'vmess') return null;
  return {
    tag,
    port,
    protocol,
    transport: first(raw.transport) || first(raw.network) || 'tcp',
    security: first(raw.security) || first(raw.tls) || 'none',
    params: paramsForInbound(raw),
    enabled: raw.enable !== false,
  };
}

async function syncHost(host: any) {
  const provider = new MarzbanProvider(host.base_url);
  const checkedAt = new Date();
  try {
    const inbounds = await provider.listInbounds();
    await pool.query(`UPDATE provider_instances SET last_ok_at=$1,updated_at=now() WHERE id=$2`, [checkedAt, host.provider_instance_id]);
    await pool.query(`UPDATE hosts SET health_status='HEALTHY',last_health_check_at=$1,updated_at=now() WHERE id=$2`, [checkedAt, host.id]);

    let synced = 0;
    for (const raw of inbounds) {
      const inbound = normalizeInbound(raw);
      if (!inbound) continue;

      const endpoint = await pool.query(`
        INSERT INTO server_endpoints(
          host_id,name,port,protocol,transport,security,provider_inbound_tag,
          public_params,status,health_status,last_health_check_at,max_services
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE','HEALTHY',$9,$10)
        ON CONFLICT(host_id,port) DO UPDATE SET
          name=EXCLUDED.name,
          protocol=EXCLUDED.protocol,
          transport=EXCLUDED.transport,
          security=EXCLUDED.security,
          provider_inbound_tag=EXCLUDED.provider_inbound_tag,
          public_params=EXCLUDED.public_params,
          health_status='HEALTHY',
          last_health_check_at=EXCLUDED.last_health_check_at,
          updated_at=now()
        RETURNING id,public_code,max_services,status
      `, [
        host.id,
        inbound.tag,
        inbound.port,
        inbound.protocol,
        inbound.transport,
        inbound.security,
        inbound.tag,
        JSON.stringify(inbound.params),
        checkedAt,
        defaultMaxServices,
      ]);

      const endpointId = endpoint.rows[0].id;
      await pool.query(`
        INSERT INTO category_endpoints(category_id,endpoint_id,status,priority)
        SELECT c.id,$1,'ACTIVE',0
        FROM config_categories c
        WHERE c.status='ACTIVE' AND c.protocol=$2
        ON CONFLICT(category_id,endpoint_id) DO UPDATE SET status='ACTIVE'
      `, [endpointId, inbound.protocol]);

      if (!inbound.enabled) {
        await pool.query(`UPDATE server_endpoints SET status='DISABLED',updated_at=now() WHERE id=$1`, [endpointId]);
      }
      synced++;
      console.log(`[endpoint-sync] ${host.name}: ${inbound.protocol}/${inbound.tag}:${inbound.port} -> ${endpoint.rows[0].public_code}`);
    }

    console.log(`[endpoint-sync] ${host.name}: synced ${synced} VLESS/VMess inbound(s)`);
    return synced;
  } catch (error) {
    await pool.query(`UPDATE hosts SET health_status='DOWN',last_health_check_at=$1,updated_at=now() WHERE id=$2`, [checkedAt, host.id]);
    await pool.query(`UPDATE server_endpoints SET health_status='DOWN',last_health_check_at=$1,updated_at=now() WHERE host_id=$2 AND status<>'DISABLED'`, [checkedAt, host.id]);
    console.error(`[endpoint-sync] ${host.name}: failed`, error instanceof Error ? error.message : error);
    return 0;
  }
}

async function recoverNoCapacityJobs() {
  const r = await pool.query(`
    SELECT DISTINCT j.id
    FROM jobs j
    JOIN order_items oi ON oi.order_id=j.subject_id
    JOIN config_plans p ON p.id=oi.plan_id
    JOIN config_categories cat ON cat.id=p.category_id
    WHERE j.type='fulfill_order'
      AND j.state IN ('SUCCEEDED','NEEDS_ATTENTION')
      AND oi.fulfillment_status='NEEDS_ATTENTION'
      AND oi.fulfillment_detail='NO_CAPACITY'
      AND EXISTS (
        SELECT 1
        FROM server_endpoints e
        JOIN category_endpoints ce ON ce.endpoint_id=e.id AND ce.category_id=cat.id AND ce.status='ACTIVE'
        JOIN hosts h ON h.id=e.host_id
        JOIN provider_instances pi ON pi.id=h.provider_instance_id AND pi.status='ACTIVE'
        WHERE e.status='ACTIVE'
          AND e.health_status='HEALTHY'
          AND h.status='ACTIVE'
          AND h.health_status IN ('HEALTHY','UNKNOWN')
          AND e.protocol=cat.protocol
          AND e.allocated_count<e.max_services
      )
  `);
  for (const row of r.rows) {
    await pool.query(`UPDATE jobs SET state='QUEUED',run_at=now(),last_error=NULL,locked_at=NULL,locked_by=NULL,updated_at=now() WHERE id=$1 AND state IN ('SUCCEEDED','NEEDS_ATTENTION')`, [row.id]);
    console.log(`[endpoint-sync] requeued fulfill_order ${row.id}`);
  }
}

async function main() {
  const hosts = await pool.query(`
    SELECT h.id,h.name,h.address,h.provider_instance_id,p.base_url
    FROM hosts h
    JOIN provider_instances p ON p.id=h.provider_instance_id
    WHERE h.status='ACTIVE' AND p.status='ACTIVE' AND p.type='MARZBAN'
    ORDER BY h.created_at
  `);

  if (!hosts.rowCount) {
    console.log('[endpoint-sync] no active Marzban hosts found');
    return;
  }

  let total = 0;
  for (const host of hosts.rows) total += await syncHost(host);
  await recoverNoCapacityJobs();
  console.log(`[endpoint-sync] complete: ${total} endpoint(s) synchronized`);
}

main().catch(error => {
  console.error('[endpoint-sync] fatal', error);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
