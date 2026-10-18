// Create a staff (admin panel) account.
// Usage (from the project root):
//   npm run staff:add -- --email=name@example.com --name="Full Name" --role=ADMIN
// The password is asked interactively (hidden) so it never lands in shell history.
// A new Authenticator (TOTP) secret is generated and printed once.
import { Pool } from 'pg';
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { authenticator } from 'otplib';

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'TECHNICIAN', 'FINANCE'];
const args = Object.fromEntries(process.argv.slice(2).map((v) => {
  const i = v.indexOf('=');
  return i > 0 ? [v.slice(0, i).replace(/^--/, ''), v.slice(i + 1)] : [v.replace(/^--/, ''), ''];
}));
const email = String(args.email || '').trim().toLowerCase();
const fullName = String(args.name || '').trim();
const role = String(args.role || 'ADMIN').toUpperCase();

if (!email || !email.includes('@')) { console.error('Missing or invalid --email=...'); process.exit(1); }
if (!fullName) { console.error('Missing --name="..."'); process.exit(1); }
if (!ROLES.includes(role)) { console.error(`Invalid --role. Use one of: ${ROLES.join(', ')}`); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required (load .env first)'); process.exit(1); }
if (!process.env.ENCRYPTION_KEY) { console.error('ENCRYPTION_KEY is required (load .env first)'); process.exit(1); }

// Same layout as encryptSecret() in apps/api/src/main.ts: [IV 12][TAG 16][CIPHERTEXT]
function encrypt(value) {
  const key = crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

function ask(question, hidden) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) { // non-interactive: read one line from stdin
      let buf = ''; stdin.setEncoding('utf8');
      stdin.on('data', (c) => { buf += c; if (buf.includes('\n')) { stdin.pause(); resolve(buf.split('\n')[0]); } });
      stdin.on('end', () => resolve(buf.split('\n')[0]));
      return;
    }
    process.stdout.write(question);
    let value = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); resolve(value); }
      else if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); }
      else if (ch === '\u007f' || ch === '\b') { value = value.slice(0, -1); }
      else { value += ch; if (!hidden) process.stdout.write(ch); }
    };
    stdin.on('data', onData);
  });
}

const password = await ask('Password for the new account (min 12 chars): ', true);
if (password.length < 12) { console.error('Password must be at least 12 characters.'); process.exit(1); }
if (process.stdin.isTTY) {
  const again = await ask('Repeat password: ', true);
  if (again !== password) { console.error('Passwords do not match.'); process.exit(1); }
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const exists = await pool.query('SELECT id FROM staff_users WHERE email=$1', [email]);
  if (exists.rowCount) { console.error(`A staff account with ${email} already exists. Nothing changed.`); process.exit(1); }
  const totpSecret = authenticator.generateSecret();
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const r = await pool.query(
    `INSERT INTO staff_users(email,full_name,password_hash,role,totp_secret_enc,totp_enabled,status)
     VALUES($1,$2,$3,$4,$5,true,'ACTIVE') RETURNING id,email,full_name,role`,
    [email, fullName, hash, role, encrypt(totpSecret)]);
  await pool.query(
    `INSERT INTO audit_logs(actor_type,action,entity_type,entity_id,metadata) VALUES('SYSTEM','staff.created_cli','staff_users',$1,$2)`,
    [r.rows[0].id, JSON.stringify({ email, role })]);
  const uri = authenticator.keyuri(email, 'CowboyBepob', totpSecret);
  console.log(`\nCreated ${r.rows[0].role} account for ${r.rows[0].email}`);
  console.log('\nAdd it to Google Authenticator / Authy / 1Password, then log in with the 6-digit code:');
  console.log(`  Manual entry key : ${totpSecret}`);
  console.log(`  Or open this URI : ${uri}`);
  console.log('\nThis key is shown only once. Store it now, then clear your terminal.');
} finally {
  await pool.end();
}
