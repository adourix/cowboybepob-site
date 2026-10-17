import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [
  path.join(root, 'apps/api/src/main.ts'),
  path.join(root, 'apps/api/src/server.ts'),
].filter(fs.existsSync);

const old = "sub.status subscription_status,sub.current_period_end,sub.starts_at,sub.used_bytes,sub.quota_bytes,cu.public_code customer_code";
const next = "sub.public_code subscription_code,sub.status subscription_status,sub.current_period_end,sub.starts_at,sub.used_bytes,sub.quota_bytes,cu.public_code customer_code";

let changed = 0;
for (const file of files) {
  const s = fs.readFileSync(file, 'utf8');
  if (!s.includes(old)) continue;
  fs.writeFileSync(file, s.replace(old, next));
  console.log(`Updated ${path.relative(root,file)}`);
  changed++;
}

if (!changed) {
  console.log('Subscription code is already present in the admin services query.');
}
