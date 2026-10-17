import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [
  path.join(root, 'apps/web/src/app.tsx'),
  path.join(root, 'apps/web/src/main.tsx'),
];

for (const file of files) {
  let s = fs.readFileSync(file, 'utf8');

  // Fastify rejects an empty request with Content-Type: application/json.
  // DELETE requests from the admin UI intentionally have no body, so only
  // advertise JSON when a body actually exists.
  const old = "const h=new Headers(init.headers);h.set('content-type','application/json');";
  const next = "const h=new Headers(init.headers);if(init.body!==undefined&&init.body!==null)h.set('content-type','application/json');";

  if (s.includes(old)) {
    s = s.replace(old, next);
  } else if (!s.includes(next)) {
    throw new Error(`API helper marker missing in ${path.relative(root, file)}`);
  }

  fs.writeFileSync(file, s);
  console.log(`Fixed DELETE request headers in ${path.relative(root, file)}`);
}

console.log('Delete buttons now send no Content-Type when they have no request body.');
