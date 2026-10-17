import fs from 'node:fs';

const webFiles = ['apps/web/src/app.tsx','apps/web/src/main.tsx'];
for (const file of webFiles) {
  let s = fs.readFileSync(file, 'utf8');

  // Subscriptions are a detail of Services, not a primary sidebar resource.
  s = s.replace(
    "['/admin/subscriptions','الاشتراكات',CreditCard],",
    ''
  );
  s = s.replace(
    "['/admin/configs','الكونفيجات',Box],",
    ''
  );

  // Show the subscription itself, config and router directly in the Services table.
  const oldServices = "services:{title:'الخدمات',endpoint:'/api/v1/admin/services',cols:['الكود','العميل','الفئة','البروتوكول','الحالة','الانتهاء'],keys:['public_code','customer_name','category','protocol','status','current_period_end']},";
  const newServices = "services:{title:'الخدمات',endpoint:'/api/v1/admin/services',cols:['الخدمة','الاشتراك','العميل','الفئة','الكونفيج','الراوتر','حالة الخدمة','حالة الاشتراك','الاستخدام','الانتهاء'],keys:['public_code','subscription_code','customer_name','category','config_code','router_code','status','subscription_status','used_bytes','current_period_end']},";
  if (s.includes(oldServices)) s = s.replace(oldServices, newServices);

  // Make the page description explicit so the relationship is clear.
  s = s.replace(
    "Heading title={m.title} sub={kind==='payments'?'مراجعة وتأكيد المدفوعات اليدوية من هنا.':'بيانات حقيقية من الـAPI.'}",
    "Heading title={m.title} sub={kind==='services'?'الخدمة هي الكيان الأساسي؛ الاشتراك والكونفيج والراوتر تفاصيل مرتبطة بها.':kind==='payments'?'مراجعة وتأكيد المدفوعات اليدوية من هنا.':'بيانات حقيقية من الـAPI.'}"
  );

  // DELETE requests must not carry an empty JSON content-type body.
  s = s.replace(
    "const h=new Headers(init.headers);h.set('content-type','application/json');",
    "const h=new Headers(init.headers);if(init.body)h.set('content-type','application/json');else h.delete('content-type');"
  );

  fs.writeFileSync(file, s);
  console.log(`updated ${file}`);
}

const apiFile = 'apps/api/src/main.ts';
let a = fs.readFileSync(apiFile, 'utf8');
const oldSelect = "s.label,s.status,s.provisioning_mode,s.created_at,c.name category,c.protocol,sub.status subscription_status";
const newSelect = "s.label,s.status,s.provisioning_mode,s.created_at,c.name category,c.protocol,sub.public_code subscription_code,sub.status subscription_status";
if (!a.includes(oldSelect)) {
  if (!a.includes(newSelect)) throw new Error('services API SELECT marker not found; refusing to modify API');
} else {
  a = a.replace(oldSelect, newSelect);
}
fs.writeFileSync(apiFile, a);
console.log(`updated ${apiFile}`);
console.log('Subscriptions are now visible as first-class details inside Services; sidebar duplicates are removed.');
