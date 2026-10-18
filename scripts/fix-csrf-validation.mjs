import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const target = path.join(root, 'apps/api/src/main.ts');
let source = fs.readFileSync(target, 'utf8');

const old = `function requireCsrf(req: Req) {\n  const token = req.headers['x-csrf-token'];\n  if (!req.csrf || typeof token !== 'string' || token !== req.csrf) throw Object.assign(new Error('CSRF validation failed'), { statusCode: 403 });\n}`;

const next = `function requireCsrf(req: Req) {\n  const token = req.headers['x-csrf-token'];\n  if (!req.csrf || typeof token !== 'string' || !crypto.timingSafeEqual(sha(token), Buffer.from(req.csrf, 'hex'))) {\n    throw Object.assign(new Error('CSRF validation failed'), { statusCode: 403 });\n  }\n}`;

if (source.includes(next)) {
  console.log('CSRF fix already applied.');
  process.exit(0);
}
if (!source.includes(old)) {
  throw new Error('Missing CSRF validation marker in apps/api/src/main.ts');
}
source = source.replace(old, next);
fs.writeFileSync(target, source);
console.log('Applied CSRF validation fix to apps/api/src/main.ts');
