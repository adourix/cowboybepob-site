import { Pool } from 'pg';
import crypto from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).map((v) => {
  const i = v.indexOf('=');
  return i > 0 ? [v.slice(0, i).replace(/^--/, ''), v.slice(i + 1)] : [v.replace(/^--/, ''), ''];
}));

const required = ['name', 'url', 'username', 'password'];
for (const key of required) {
  if (!args[key]) {
    console.error(`Missing --${key}=...`);
    process.exit(1);
  }
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!process.env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is required');

function encrypt(value) {
  const key = crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const secret = encrypt(JSON.stringify({ username: args.username, password: args.password }));
  const result = await pool.query(`
    INSERT INTO provider_instances(name,type,base_url,credentials_ref,credentials_enc,status)
    VALUES($1,'MARZBAN',$2,'db:aes-256-gcm',$3,'ACTIVE')
    ON CONFLICT(name) DO UPDATE SET
      base_url=EXCLUDED.base_url,
      credentials_ref=EXCLUDED.credentials_ref,
      credentials_enc=EXCLUDED.credentials_enc,
      status='ACTIVE',
      updated_at=now()
    RETURNING id,name,base_url,status
  `, [args.name, args.url.replace(/\/$/, ''), secret]);
  console.log(JSON.stringify(result.rows[0], null, 2));
} finally {
  await pool.end();
}
