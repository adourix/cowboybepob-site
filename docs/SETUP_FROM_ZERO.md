# CowboyBepob — تشغيل المشروع من الصفر

هذا هو مسار التشغيل الحالي بعد إضافة Resend وإكمال تدفقات التسجيل والطلبات والـWorker.

## 1. المعمارية

```text
Cloudflare Tunnel
      |
      v
Nginx :5001
  |         \
  |          \-- /api -> Fastify :5002
  v
React/Vite

Fastify :5002 -> PostgreSQL :5432
Fastify       -> Marzban Provider
Worker        -> PostgreSQL jobs -> Marzban
Fastify       -> Resend API -> customer email
```

المشروع Native؛ لا Docker مطلوب للتشغيل الأساسي.

المستخدم والملكية:

```text
abdulrahman:abdulrahman
/home/abdulrahman/projects/cowboybepob
```

## 2. بعد `git pull`

```bash
cd ~/projects/cowboybepob
git pull --ff-only
npm install
npm test
npm run typecheck
npm run build
```

إذا كان المشروع منشورًا بالفعل بالخدمات الحالية:

```bash
sudo systemctl restart cowboybepob-api
sudo systemctl restart cowboybepob-worker
sudo systemctl status cowboybepob-api --no-pager
sudo systemctl status cowboybepob-worker --no-pager
```

## 3. PostgreSQL

على تثبيت جديد:

```bash
sudo -u postgres psql
```

```sql
CREATE USER cowboybepob WITH PASSWORD 'CHANGE_THIS_PASSWORD';
CREATE DATABASE cowboybepob OWNER cowboybepob;
\q
```

ثم:

```bash
PGPASSWORD='CHANGE_THIS_PASSWORD' psql -h 127.0.0.1 -U cowboybepob -d cowboybepob -f db/schema.sql
PGPASSWORD='CHANGE_THIS_PASSWORD' psql -h 127.0.0.1 -U cowboybepob -d cowboybepob -f db/migrations/001_provider_credentials.sql
PGPASSWORD='CHANGE_THIS_PASSWORD' psql -h 127.0.0.1 -U cowboybepob -d cowboybepob -f db/migrations/002_email_verification.sql
```

على قاعدة موجودة بالفعل، نفّذ migrations الجديدة فقط.

## 4. `.env`

```bash
cp .env.example .env
nano .env
```

الإعدادات المطلوبة:

```env
NODE_ENV=production
PORT=5002
DATABASE_URL=postgres://cowboybepob:DB_PASSWORD@127.0.0.1:5432/cowboybepob
CORS_ORIGIN=https://cowboybebop.site
PUBLIC_APP_URL=https://cowboybebop.site
COOKIE_SECURE=true
SESSION_DAYS=7
ENCRYPTION_KEY=RANDOM_SECRET
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=STRONG_PASSWORD
ADMIN_TOTP_SECRET=BASE32_TOTP_SECRET
VITE_API_URL=/

RESEND_API_KEY=re_xxxxxxxxx
MAIL_FROM_EMAIL=no-reply@cowboybebop.site
MAIL_FROM_NAME=CowboyBepob
```

لا تضع Marzban username/password في `.env`؛ يتم تخزينهما مشفرين داخل `provider_instances.credentials_enc`.

## 5. Resend

الكود يستخدم REST API مباشرة ولا يحتاج dependency إضافية.

المتغيرات:

```env
RESEND_API_KEY=...
MAIL_FROM_EMAIL=no-reply@cowboybebop.site
MAIL_FROM_NAME=CowboyBepob
PUBLIC_APP_URL=https://cowboybebop.site
```

قبل الإرسال من `@cowboybebop.site` يجب إضافة الدومين والتحقق منه في Resend، ثم إضافة سجلات DNS التي يعرضها Resend. Resend يدعم إدارة والتحقق من الدومينات وواجهته موجهة للاستخدام البرمجي. urlResend Transactional Emailhttps://www.resend.com/products/transactional-emails

## 6. Email verification

التسجيل أصبح:

```text
POST /api/v1/customer/auth/register
        |
        v
create customer with email_verified_at = NULL
        |
        v
create auth_tokens purpose=EMAIL_VERIFY
        |
        v
Resend
        |
        v
https://cowboybebop.site/verify-email?token=...
        |
        v
GET /api/v1/customer/auth/verify-email
        |
        v
email_verified_at = now()
```

العميل لا يستطيع تسجيل الدخول قبل تأكيد البريد.

يوجد أيضًا:

```text
POST /api/v1/customer/auth/resend-verification
POST /api/v1/customer/auth/forgot-password
POST /api/v1/customer/auth/reset-password
```

## 7. Marzban Provider

إما من CLI:

```bash
npm run provider:add -- \
  --name="Default Marzban" \
  --url="http://MARZBAN_SERVER:8000" \
  --username="MARZBAN_USERNAME" \
  --password="MARZBAN_PASSWORD"
```

أو من لوحة الإدارة بعد تشغيل الـAPI:

```text
الإعدادات -> Marzban Providers -> إضافة مزود
```

الـcredentials تُشفّر باستخدام `ENCRYPTION_KEY`.

## 8. إعداد Server وEndpoint

من لوحة الإدارة:

```text
الإعدادات
  -> إضافة Marzban Provider

الخوادم
  -> إضافة خادم
  -> إضافة Endpoint
```

الـEndpoint يحتاج على الأقل:

```text
host
port
protocol = vless أو vmess
provider_inbound_tag
max_services
```

عند إنشاء Endpoint جديد، قاعدة البيانات تربطه تلقائيًا بالفئات النشطة التي تستخدم نفس البروتوكول حسب trigger الموجود في `db/schema.sql`.

## 9. مسار الشراء الكامل

```text
Customer registration
  -> Email verification
  -> Login
  -> Catalog
  -> Buy plan
  -> Order PENDING_PAYMENT
  -> Payment request
  -> Admin records manual payment
  -> Job fulfill_order
  -> Worker
  -> Service + Subscription
  -> Endpoint allocation
  -> Config + UUID
  -> Marzban user
  -> Service ACTIVE
  -> Customer sees config
```

إذا تم شراء Router مع الخدمة واستخدم `useWithRouter=true`، يقوم الـWorker بربط الخدمة بالراوتر الذي تم تخصيصه من المخزون.

## 10. المدفوعات الحالية

التنفيذ الحالي يدعم:

```text
Manual payment
Payment webhook foundation
Idempotency
Audit logs
```

العميل ينشئ طلب الدفع، ثم الإدارة تسجل التحويل من:

```text
المدفوعات
```

بعد نجاح الدفع يتم إنشاء:

```text
fulfill_order
```

## 11. Worker

الخدمة:

```text
cowboybepob-worker.service
```

يقرأ jobs من PostgreSQL باستخدام:

```sql
FOR UPDATE SKIP LOCKED
```

الوظائف الحالية:

```text
fulfill_order
provision_service
renew_service
service_action
expiry_sweep
```

وتوجد retries و`NEEDS_ATTENTION` عندما تتجاوز المهمة `max_attempts`.

## 12. Suspend / Resume / Terminate

من API الإدارة يمكن إرسال:

```text
suspend
resume
terminate
retry
```

الـWorker يزامن العمليات مع Marzban:

```text
suspend   -> disable Marzban user
resume    -> enable Marzban user
terminate -> delete Marzban user
```

## 13. انتهاء الاشتراك

الـWorker يعمل expiry sweep دوريًا:

```text
ACTIVE
  -> EXPIRED
  -> disable Marzban
  -> grace period
  -> retention
  -> delete Marzban user
  -> release endpoint capacity
  -> service TERMINATED
```

الإعدادات الافتراضية:

```env
GRACE_PERIOD_DAYS=3
RETENTION_DAYS=30
```

## 14. الواجهة

### Staff

```text
/admin
/admin/customers
/admin/services
/admin/subscriptions
/admin/routers
/admin/servers
/admin/catalog
/admin/orders
/admin/payments
/admin/jobs
/admin/audit
/admin/settings
```

### Customer

العميل لديه:

```text
الخدمات
الاشتراكات
الـRouter IDs
الكونفيجات
الكتالوج
شراء خدمة
شراء Router
تجديد الخدمة
الطلبات
```

## 15. Config links

الخدمة تدعم:

```text
VLESS
VMess
```

يتم بناء الرابط من:

```text
UUID
endpoint address
port
transport
security
public params
```

الـUUID محفوظ مشفرًا داخل `configs.client_credential_enc`.

## 16. Nginx

الـCowboyBepob يستخدم:

```text
5001 -> static React
/api/ -> 127.0.0.1:5002
```

لا تحذف أو تستبدل إعدادات Lingo Store.

الملف:

```text
deploy/nginx/cowboybepob.conf
```

## 17. Cloudflare

المسار الحالي:

```text
cowboybebop.site
      -> Cloudflare Tunnel #2
      -> 127.0.0.1:5001
      -> Nginx
```

Lingo له Tunnel/service مستقل.

## 18. Systemd

الخدمتان:

```text
cowboybepob-api.service
cowboybepob-worker.service
```

كلاهما يعمل باسم:

```text
abdulrahman
```

الأوامر:

```bash
sudo systemctl daemon-reload
sudo systemctl restart cowboybepob-api
sudo systemctl restart cowboybepob-worker
```

السجلات:

```bash
sudo journalctl -u cowboybepob-api -f
sudo journalctl -u cowboybepob-worker -f
```

## 19. Health checks

```bash
curl -i http://127.0.0.1:5002/health
curl -I http://127.0.0.1:5001
curl -I https://cowboybebop.site
```

Nginx:

```bash
sudo nginx -t
sudo systemctl status nginx --no-pager
```

Ports:

```bash
sudo ss -ltnp | grep -E ':5001|:5002|:5432'
```

## 20. إذا حصل خطأ بعد `git pull`

نفّذ بالترتيب:

```bash
cd ~/projects/cowboybepob
git pull --ff-only
npm install
npm run typecheck
npm run build
sudo systemctl restart cowboybepob-api cowboybepob-worker
```

ثم:

```bash
sudo journalctl -u cowboybepob-api -n 100 --no-pager
sudo journalctl -u cowboybepob-worker -n 100 --no-pager
```

إذا كان الخطأ من PostgreSQL، راجع:

```bash
cat .env
```

بدون نشر محتوى الأسرار في chat أو Git.

## 21. Git workflow

المطلوب بعد أي تحديث:

```bash
cd ~/projects/cowboybepob
git pull --ff-only
npm install
npm run typecheck
npm run build
sudo systemctl restart cowboybepob-api cowboybepob-worker
```

لا تستخدم:

```bash
sudo npm install
sudo npm run build
```

## 22. Production checklist

قبل اعتبار النظام جاهزًا:

- [ ] PostgreSQL يعمل
- [ ] schema مطبق
- [ ] migrations `001` و`002` مطبقة
- [ ] `.env` موجود وغير committed
- [ ] `ENCRYPTION_KEY` مضبوط
- [ ] Resend domain verified
- [ ] `RESEND_API_KEY` مضبوط
- [ ] sender email صحيح
- [ ] Marzban Provider مضاف وcredentials محفوظة
- [ ] Server مضاف
- [ ] Endpoint مضاف
- [ ] Endpoint protocol مطابق للفئة
- [ ] Worker يعمل
- [ ] API يعمل
- [ ] Nginx يعمل
- [ ] Cloudflare Tunnel يعمل
- [ ] HTTPS يعمل
- [ ] تسجيل العميل وإرسال verification email يعمل
- [ ] تأكيد البريد يعمل
- [ ] تسجيل الدخول يعمل
- [ ] إنشاء Order يعمل
- [ ] تسجيل Manual Payment يعمل
- [ ] Worker ينفذ fulfillment
- [ ] Marzban user يتم إنشاؤه
- [ ] Service تصبح ACTIVE
- [ ] Config link يظهر للعميل
- [ ] renewal يعمل
- [ ] suspend/resume/terminate تعمل
- [ ] expiry sweep تعمل

## 23. ملفات التنفيذ الأساسية

```text
apps/api/src/main.ts
apps/api/src/email.ts
apps/api/src/marzban.ts
apps/api/src/worker.ts
apps/api/scripts/add-provider.mjs
apps/web/src/app.tsx
db/schema.sql
db/migrations/001_provider_credentials.sql
db/migrations/002_email_verification.sql
deploy/systemd/cowboybepob-api.service
deploy/systemd/cowboybepob-worker.service
deploy/nginx/cowboybepob.conf
deploy/install-native.sh
```

هذا الملف هو مسار التشغيل السريع. أما `docs/OPERATIONS_RUNBOOK.md` فهو المرجع التشغيلي التفصيلي الموجود في المشروع.
