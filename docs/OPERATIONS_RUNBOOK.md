# CowboyBepob — Complete Deployment & Operations Runbook

> هذا الملف هو المرجع التشغيلي الرئيسي لأي شخص سيكمل تطوير أو تشغيل المشروع بعد ذلك.
>
> الهدف: يشرح **من الصفر** كيف يعمل المشروع، أين توجد الملفات، كيف يتم تشغيله Native على Ubuntu/Debian، كيف تتصل الواجهة بالـAPI، كيف يعمل PostgreSQL وWorker وMarzban وNginx وCloudflare، وما الذي تم إنجازه وما الذي لم يُنجز بعد.

---

## 1. تعريف المشروع

`CowboyBepob` عبارة عن منصة MVP لإدارة وبيع خدمات Proxy/Subscriptions والراوترات.

المشروع مبني كـ **Native deployment** على Ubuntu/Debian، بدون Docker في طريقة التشغيل الأساسية الحالية.

المكونات الرئيسية:

```text
Browser
  |
  | HTTPS
  v
Cloudflare
  |
  | Tunnel
  v
Nginx :5001
  |
  +--------------------------+
  |                          |
  | static files             | /api/*
  v                          v
React/Vite build         Fastify API :5002
                             |
                             +-------- PostgreSQL :5432
                             |
                             +-------- Marzban Provider
                             |
                             +-------- DB Jobs

Worker
  |
  +---- PostgreSQL jobs
  |
  +---- Marzban provisioning
```

الموقع العام:

```text
https://cowboybebop.site
```

---

# 2. المستودع

GitHub repository:

```text
adourix/cowboybepob-site
```

الفرع الأساسي:

```text
main
```

المجلد على السيرفر:

```text
/home/abdulrahman/projects/cowboybepob
```

المستخدم الذي يملك المشروع ويشغله:

```text
abdulrahman
```

**مهم:** لا يوجد service user منفصل اسمه `cowboybepob` في التصميم الحالي.

---

# 3. قاعدة مهمة جدًا: ownership

كل ملفات المشروع يجب أن تكون مملوكة لـ:

```text
abdulrahman:abdulrahman
```

ويشمل ذلك:

```text
/home/abdulrahman/projects/cowboybepob
/home/abdulrahman/projects/cowboybepob/.env
```

أوامر npm والتطوير والبناء يجب أن تعمل كمستخدم `abdulrahman`.

مثال صحيح:

```bash
cd ~/projects/cowboybepob
npm install
npm run typecheck
npm run build
```

لا تستخدم:

```bash
sudo npm install
sudo npm run build
```

ولا تستخدم service user آخر للمشروع.

`sudo` يستخدم فقط لأوامر النظام مثل:

```bash
sudo systemctl ...
sudo nginx -t
sudo cp ... /etc/...
sudo systemctl reload nginx
```

---

# 4. المنافذ

| Port | الاستخدام | Public؟ |
|---|---|---|
| 5001 | Nginx + React + reverse proxy للـAPI | نعم محليًا، والـpublic يتم عبر Cloudflare Tunnel |
| 5002 | Fastify API | لا، localhost فقط في التصميم |
| 5003 | Vite dev server | تطوير فقط |
| 5432 | PostgreSQL | لا |
| 8000 | Marzban حسب بيئة السيرفر | يعتمد على مكان Marzban |

المسار الأساسي:

```text
Browser
  -> Cloudflare
  -> 127.0.0.1:5001
  -> Nginx
```

والـAPI:

```text
Browser
  -> /api/...
  -> Nginx :5001
  -> 127.0.0.1:5002
```

---

# 5. ملفات المشروع المهمة

## Root

```text
package.json
.env.example
README.md
docs/
db/
deploy/
scripts/
apps/
```

## API

```text
apps/api/
```

أهم الملفات:

```text
apps/api/src/main.ts
apps/api/src/marzban.ts
apps/api/src/worker.ts
apps/api/scripts/add-provider.mjs
```

### `main.ts`

المسؤول عن:

- Fastify API
- authentication
- sessions
- CSRF
- RBAC
- TOTP
- customers
- services
- routers
- servers
- catalog
- orders
- payments
- jobs
- audit
- settings
- dashboard
- customer portal APIs
- admin APIs
- health endpoint

### `marzban.ts`

Adapter للتعامل مع Marzban.

يدعم أساسًا:

```text
POST /api/admin/token
POST /api/user
GET  /api/user/{username}
PUT  /api/user/{username}
```

بالإضافة إلى عمليات:

- enable
- disable
- delete
- reset usage
- usage
- health

بيانات Marzban لا توضع في `.env` في التصميم الحالي.

### `worker.ts`

Worker مستقل يعالج الـjobs الموجودة في PostgreSQL.

يعتمد على:

```sql
FOR UPDATE SKIP LOCKED
```

حتى لا يعالج أكثر من Worker نفس الـjob في نفس الوقت.

وظائفه تشمل:

- fulfillment
- service provisioning
- service renewal
- expiry sweep
- Marzban provisioning
- retries
- releasing capacity
- انتهاء الخدمات

---

# 6. Frontend

المسار:

```text
apps/web/
```

الواجهة:

```text
React + TypeScript + Vite
```

ملفات مهمة:

```text
apps/web/src/app.tsx
apps/web/src/main.tsx
apps/web/src/styles.css
apps/web/src/vite-env.d.ts
apps/web/index.html
```

## `app.tsx`

هو entry الحالي للواجهة الحديثة.

يحتوي على:

- login
- customer registration
- admin shell
- customer portal
- dashboard
- customers
- services
- subscriptions
- routers
- servers
- catalog
- orders
- payments
- jobs
- audit
- settings

كما يحتوي على routing باستخدام React Router.

---

# 7. Authentication

هناك نوعان من المستخدمين:

```text
STAFF
CUSTOMER
```

## Staff

يدخل من لوحة الموظفين.

الـstaff authentication يدعم:

- password
- session
- TOTP
- RBAC

الـadmin الأول يتم bootstrap له من environment variables.

المتغيرات:

```env
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
ADMIN_TOTP_SECRET=...
```

## Customer

العميل يستطيع التسجيل من الواجهة.

الـendpoint المستخدم:

```text
POST /api/v1/customer/auth/register
```

ثم تسجيل الدخول من:

```text
POST /api/v1/auth/login
```

بعد login:

```text
STAFF    -> /admin
CUSTOMER -> /customer
```

الواجهة تستعيد الجلسة عند Refresh باستخدام:

```text
GET /api/v1/auth/me
```

---

# 8. لماذا ظهر Failed to fetch في التسجيل سابقًا؟

الرسالة:

```text
Failed to fetch
```

لا تعني بالضرورة أن بيانات التسجيل خطأ.

هي غالبًا تعني أن Browser لم يستطع الوصول إلى API.

المسار المفترض:

```text
https://cowboybebop.site/api/...
       |
       v
Cloudflare
       |
       v
Nginx :5001
       |
       v
Fastify :5002
```

إذا ظهر الخطأ، نفّذ:

```bash
curl -i https://cowboybebop.site/api/v1/auth/me
```

ثم:

```bash
sudo systemctl status cowboybepob-api --no-pager
```

ثم:

```bash
sudo nginx -t
```

ثم:

```bash
curl -i http://127.0.0.1:5002/health
```

---

# 9. PostgreSQL

قاعدة البيانات هي مصدر الحالة التجارية للمشروع.

المكونات الأساسية الموجودة في schema تشمل:

```text
customers
customer_landlines
staff_users
auth_sessions
auth_tokens
provider_instances
hosts
server_endpoints
config_categories
category_endpoints
config_plans
router_products
routers
tailscale_devices
router_replacements
services
configs
proxy_accounts
service_allocations
subscriptions
subscription_periods
orders
order_items
payments
payment_events
refunds
jobs
audit_logs
app_settings
```

Extensions المستخدمة:

```text
pgcrypto
citext
```

---

# 10. إنشاء PostgreSQL من الصفر

إذا كان السيرفر جديدًا:

```bash
sudo -u postgres psql
```

ثم:

```sql
CREATE USER cowboybepob WITH PASSWORD 'CHANGE_THIS_PASSWORD';
CREATE DATABASE cowboybepob OWNER cowboybepob;
\q
```

بعدها:

```bash
cd ~/projects/cowboybepob
PGPASSWORD='CHANGE_THIS_PASSWORD' psql \
  -h 127.0.0.1 \
  -U cowboybepob \
  -d cowboybepob \
  -f db/schema.sql
```

ثم migration الخاصة بـMarzban credentials:

```bash
PGPASSWORD='CHANGE_THIS_PASSWORD' psql \
  -h 127.0.0.1 \
  -U cowboybepob \
  -d cowboybepob \
  -f db/migrations/001_provider_credentials.sql
```

هذه الـmigration تضيف:

```text
provider_instances.credentials_enc
```

وتضيف index على status.

---

# 11. Environment

الملف الحقيقي:

```text
/home/abdulrahman/projects/cowboybepob/.env
```

لا يتم وضعه في Git.

ابدأ من:

```bash
cd ~/projects/cowboybepob
cp .env.example .env
nano .env
```

القيم الأساسية:

```env
NODE_ENV=production
PORT=5002
DATABASE_URL=postgres://cowboybepob:DB_PASSWORD@127.0.0.1:5432/cowboybepob
CORS_ORIGIN=http://SERVER_IP:5001
COOKIE_SECURE=false
SESSION_DAYS=7
ENCRYPTION_KEY=RANDOM_32_BYTE_SECRET
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=STRONG_ADMIN_PASSWORD
ADMIN_TOTP_SECRET=BASE32_TOTP_SECRET
VITE_API_URL=/
```

## ملاحظات Environment

`PORT`:

```text
5002
```

لأن Nginx يعمل كـreverse proxy من 5001 إلى 5002.

`VITE_API_URL`:

```text
/
```

وبالتالي الواجهة تستخدم نفس الـorigin وتطلب:

```text
/api/...
```

بدون وضع عنوان API خارجي في Browser.

---

# 12. Encryption

بيانات حساسة مثل credentials الخاصة بـMarzban تُخزن مشفرة داخل PostgreSQL.

المفتاح يأتي من:

```env
ENCRYPTION_KEY
```

التشفير المستخدم:

```text
AES-256-GCM
```

والـlayout المستخدم للقيمة المشفرة:

```text
[IV 12 bytes][TAG 16 bytes][CIPHERTEXT]
```

لا تضع credentials الخاصة بـMarzban داخل Git أو `.env` في هذا التصميم.

---

# 13. إضافة Marzban Provider

بعد تشغيل PostgreSQL وضبط `.env`:

```bash
cd ~/projects/cowboybepob
npm run provider:add -- \
  --name="Default Marzban" \
  --url="http://MARZBAN_SERVER:8000" \
  --username="MARZBAN_USERNAME" \
  --password="MARZBAN_PASSWORD"
```

السكريبت:

```text
apps/api/scripts/add-provider.mjs
```

يقوم بـ:

1. قراءة `DATABASE_URL`.
2. قراءة `ENCRYPTION_KEY`.
3. تشفير username/password.
4. تخزينها في `provider_instances.credentials_enc`.
5. عمل upsert للـprovider.

بعد الإضافة، يمكن للـAPI resolve credentials حسب `base_url` إذا لم يتم تمرير credentials صراحة.

---

# 14. Marzban provisioning

الـWorker هو المسؤول عن تنفيذ provisioning بعد إنشاء الـjob.

المسار العام:

```text
Order
  |
  v
Job
  |
  v
Worker
  |
  v
Provider / Marzban
  |
  v
Proxy User
  |
  v
Config
  |
  v
Service
```

عند وجود خطأ Marzban:

- أخطاء `4xx` تعامل كـpermanent failure.
- أخطاء `5xx` يمكن إعادة المحاولة.

---

# 15. Server / Endpoint model

لا يكفي وجود Marzban فقط.

يجب أن يكون هناك:

```text
Host
  |
  +--- Server Endpoint
          |
          +--- Category Endpoint mapping
```

ويجب أن يكون `server_endpoint` فعالًا ومرتبطًا بالفئة المناسبة.

كما يجب أن يطابق:

```text
provider_inbound_tag
```

الـinbound الحقيقي داخل Marzban.

إذا لم يوجد endpoint صحيح، provisioning الخدمة لن يعمل بشكل صحيح حتى لو كان Marzban نفسه يعمل.

---

# 16. Config Categories

الفئات تحدد نوع البروتوكول والخدمة.

أمثلة البروتوكولات التي يدعمها التصميم:

```text
VLESS
VMess
```

العلاقة:

```text
Config Category
      |
      v
Category Endpoint
      |
      v
Server Endpoint
      |
      v
Marzban inbound
```

---

# 17. Plans

الـPlan مرتبط بالفئة ويحتوي على السعر والمدة.

من أهم القيم:

```text
duration_days
price_minor
currency
```

الـWorker يستخدم `duration_days` عند إنشاء أو تجديد subscription.

---

# 18. Services / Config / Subscription

العلاقة المنطقية:

```text
Customer
   |
   v
Service
   |
   +---- Subscription
   |
   +---- Config
   |
   +---- Proxy Account
   |
   +---- Service Allocation
   |
   +---- Router relationship
```

الخدمة هي العنصر الذي يظهر للعميل في Customer Portal.

العميل يستطيع رؤية:

- Service code
- status
- Router ID
- router model
- router connectivity
- subscription status
- expiry
- config link

---

# 19. Router ID

الراوترات لها public identifier يعرض في الواجهة باسم:

```text
Router ID
```

وتوجد بيانات مثل:

```text
serial_number
device_identifier
model
firmware_version
lifecycle_status
connectivity
last_seen_at
```

صفحة الراوترات في Admin تستخدم:

```text
GET /api/v1/admin/routers
```

والإضافة تستخدم:

```text
POST /api/v1/admin/routers
```

من الواجهة الحالية يوجد Modal لتسجيل الراوتر.

---

# 20. Customer Portal

المسار:

```text
/customer
```

الواجهة الحالية تجمع في مكان واحد:

```text
خدماتي
راوتراتي
طلباتي
الكتالوج
```

كل Service card تعرض:

```text
Service Code
Service Status
Router ID
Router Model
Router Connectivity
Subscription Status
Expiry
```

وزر:

```text
عرض الكونفيج
```

يطلب:

```text
GET /api/v1/customer/services/:id/config
```

ويعرض link الناتج، مع زر نسخ.

---

# 21. Admin Portal

المسارات الأساسية:

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

القائمة كلها تستخدم نفس React Router وShell.

لا يوجد فصل بين صفحات كانت تظهر في أماكن مختلفة بسبب Routes منفصلة.

---

# 22. صفحات Admin ومصادر البيانات

## Dashboard

```text
GET /api/v1/admin/dashboard
```

## Customers

```text
GET  /api/v1/admin/customers
POST /api/v1/admin/customers
```

## Services

```text
GET /api/v1/admin/services
```

## Subscriptions

الواجهة الحالية تعرض الاشتراكات من بيانات الخدمات التي تحتوي على subscription information.

أي تطوير لاحق يجب أن يحافظ على أن:

```text
Service
Subscription
Customer
Plan
```

مرتبطة ببعضها في نفس الـdomain model.

## Routers

```text
GET  /api/v1/admin/routers
POST /api/v1/admin/routers
```

## Servers

قراءة الخوادم:

```text
GET /api/v1/admin/servers
```

إضافة Host:

```text
POST /api/v1/admin/servers/hosts
```

## Catalog

```text
GET /api/v1/admin/catalog
```

## Payments

```text
GET /api/v1/admin/payments
```

## Jobs

```text
GET /api/v1/admin/jobs
```

## Audit

```text
GET /api/v1/admin/audit-logs
```

## Settings

```text
GET /api/v1/admin/settings
```

---

# 23. Orders

المنصة تستخدم order flow بدل إنشاء الخدمة مباشرة في كل الحالات.

المسار المنطقي:

```text
Customer
  |
  v
Catalog / Plan
  |
  v
Order
  |
  v
Payment
  |
  v
Fulfillment Job
  |
  v
Service
  |
  v
Subscription + Config
```

الـOrders تستخدم idempotency حتى لا يؤدي تكرار نفس الطلب إلى إنشاء fulfillment مكرر.

---

# 24. Payments

يوجد حاليًا:

- manual payments
- payment events foundation
- webhook foundation

لكن لا تعتبر بوابة دفع تجارية كاملة.

الـpayment gateway التجاري الكامل ما زال خارج MVP.

---

# 25. Jobs / Worker

الـjobs مخزنة في PostgreSQL.

الـWorker يعمل بشكل مستقل:

```text
systemd
  |
  v
cowboybepob-worker
  |
  v
npm run start:worker
```

ويأخذ jobs باستخدام locking:

```sql
FOR UPDATE SKIP LOCKED
```

الحالات الأساسية:

```text
QUEUED
RUNNING
FAILED
COMPLETED
```

والـWorker يتعامل مع retries حسب نوع الخطأ.

---

# 26. Expiry / Renewal

الـWorker يحتوي على منطق لتجديد وإنهاء الخدمات.

عند renewal:

```text
Subscription period
   |
   v
Marzban user update
   |
   v
new expiry
```

عند انتهاء الخدمة:

```text
Service expires
   |
   v
Disable Marzban user
   |
   v
grace period
   |
   v
retention
   |
   v
delete provider user if required
   |
   v
release capacity
   |
   v
allocation RETIRED
   |
   v
service TERMINATED
```

---

# 27. Audit Logs

المنصة تحتوي على audit logging للأحداث الحساسة.

يجب عدم إزالة الـaudit عند إضافة عمليات جديدة مثل:

- كشف config
- تغيير credentials
- تعديل خدمات
- provisioning
- admin actions
- payment actions

---

# 28. Nginx

الملف الموجود في الريبو:

```text
deploy/nginx/cowboybepob.conf
```

يتم نسخه إلى:

```text
/etc/nginx/conf.d/cowboybepob.conf
```

الإعداد يستمع على:

```text
5001
```

والـroot هو:

```text
/home/abdulrahman/projects/cowboybepob/apps/web/dist
```

والـAPI:

```text
/api/ -> http://127.0.0.1:5002
```

والـhealth:

```text
/health -> http://127.0.0.1:5002/health
```

والـSPA fallback:

```nginx
try_files $uri $uri/ /index.html;
```

---

# 29. تحذير Nginx مهم جدًا

السيرفر عليه Lingo Store أيضًا.

لذلك **ممنوع** عمل:

```bash
rm /etc/nginx/conf.d/*
```

أو استبدال كامل إعدادات Nginx.

إعداد CowboyBepob يتم إضافته بشكل additive:

```bash
sudo cp ~/projects/cowboybepob/deploy/nginx/cowboybepob.conf \
  /etc/nginx/conf.d/cowboybepob.conf

sudo nginx -t
sudo systemctl reload nginx
```

لا تلمس إعدادات Lingo Store.

---

# 30. Cloudflare architecture

الـdomain الحالي:

```text
cowboybebop.site
```

ويتم استخدام Cloudflare Tunnel منفصل عن Tunnel الخاص بـLingo Store.

المسار:

```text
Cloudflare Account 2
      |
      v
cowboybebop.site
      |
      v
Tunnel #2
      |
      v
127.0.0.1:5001
      |
      v
Nginx
```

Lingo Store يبقى على Tunnel/service الخاص به.

---

# 31. Cloudflared service

تم إنشاء service مستقل لـCowboyBepob باسم:

```text
cloudflared-cowboybepob.service
```

ولا يجب دمجه مع service الخاص بـLingo.

الهدف هو عزل:

```text
Lingo Tunnel
```

عن:

```text
CowboyBepob Tunnel
```

كان Tunnel الخاص بـCowboyBepob يعمل واتصالاته المسجلة كانت متعددة، وبالتالي المسار الخارجي كان:

```text
cowboybebop.site
 -> Cloudflare Tunnel
 -> 127.0.0.1:5001
```

**لا تحفظ أو تضع Cloudflare tunnel token داخل هذا الملف.** إذا تم تسريب token في مكان عام أو محادثة، يجب تدويره من Cloudflare.

---

# 32. اختبار Cloudflare

بعد تشغيل Nginx وTunnel:

```bash
curl -I https://cowboybebop.site
```

المتوقع:

```text
HTTP/2 200
```

اختبار API من نفس الدومين:

```bash
curl -i https://cowboybebop.site/api/v1/auth/me
```

---

# 33. systemd API

الملف:

```text
deploy/systemd/cowboybepob-api.service
```

الخدمة:

```text
cowboybepob-api.service
```

تعمل باسم:

```text
User=abdulrahman
Group=abdulrahman
```

WorkingDirectory:

```text
/home/abdulrahman/projects/cowboybepob
```

Environment:

```text
/home/abdulrahman/projects/cowboybepob/.env
```

Start command:

```text
npm run start:api
```

---

# 34. systemd Worker

الملف:

```text
deploy/systemd/cowboybepob-worker.service
```

الخدمة:

```text
cowboybepob-worker.service
```

وتعمل أيضًا باسم:

```text
abdulrahman
```

Start command:

```text
npm run start:worker
```

---

# 35. تثبيت systemd يدويًا

```bash
cd ~/projects/cowboybepob

sudo cp deploy/systemd/cowboybepob-api.service \
  /etc/systemd/system/

sudo cp deploy/systemd/cowboybepob-worker.service \
  /etc/systemd/system/

sudo systemctl daemon-reload

sudo systemctl enable cowboybepob-api
sudo systemctl enable cowboybepob-worker

sudo systemctl start cowboybepob-api
sudo systemctl start cowboybepob-worker
```

أو:

```bash
sudo systemctl enable --now cowboybepob-api cowboybepob-worker
```

---

# 36. Restart بعد deploy

بعد Pull + Build للـfrontend فقط، غالبًا يكفي reload Nginx إذا كان Nginx يخدم الملفات الجديدة مباشرة.

لضمان الحالة كاملة:

```bash
sudo systemctl restart cowboybepob-api
sudo systemctl restart cowboybepob-worker
sudo systemctl reload nginx
```

---

# 37. Native installer

يوجد script:

```text
deploy/install-native.sh
```

وظيفته:

1. التأكد من وجود user `abdulrahman`.
2. تثبيت packages الأساسية.
3. تثبيت Node.js 22 إذا لم يكن مناسبًا.
4. clone أو pull للمشروع.
5. ضبط ownership.
6. `npm install`.
7. `npm test`.
8. `npm run typecheck`.
9. `npm run build`.
10. تثبيت systemd files.
11. تثبيت Nginx config بشكل additive.
12. عمل `nginx -t`.
13. enable للخدمات.

تشغيله من root:

```bash
sudo bash deploy/install-native.sh
```

قبل بدء الخدمات يجب التأكد أن:

- PostgreSQL جاهز.
- schema مطبق.
- migrations مطبقة.
- `.env` موجود وصحيح.

---

# 38. Audit script

يوجد:

```text
deploy/audit-native.sh
```

تشغيل:

```bash
cd ~/projects/cowboybepob
bash deploy/audit-native.sh
```

يفحص:

- project ownership
- Node
- npm
- psql
- PostgreSQL
- Nginx
- API service
- Worker service
- API health
- public site
- public health
- Nginx config
- ports
- DB connectivity
- typecheck
- build

في النهاية يجب أن تحصل على:

```text
AUDIT RESULT: PASS
```

---

# 39. Build / Test commands

من root المشروع:

```bash
cd ~/projects/cowboybepob
```

تثبيت dependencies:

```bash
npm install
```

Architecture test:

```bash
npm test
```

TypeScript:

```bash
npm run typecheck
```

Build API + Web:

```bash
npm run build
```

كل شيء:

```bash
npm install
npm test
npm run typecheck
npm run build
```

---

# 40. package scripts

الـroot `package.json` يحتوي على:

```text
npm run dev
npm run build
npm run typecheck
npm test
npm run start:api
npm run start:worker
npm run provider:add
```

المعاني:

### dev

يشغل API وWeb معًا.

### build

يبني:

```text
API
Web
```

### typecheck

يفحص TypeScript في:

```text
apps/api
apps/web
```

### test

يشغل:

```text
scripts/test-architecture.mjs
```

### start:api

يشغل API production.

### start:worker

يشغل Worker production.

### provider:add

يضيف Marzban provider مشفرًا في DB.

---

# 41. Development

## API

```bash
cd ~/projects/cowboybepob
npm run dev -w @cowboybepob/api
```

## Web

```bash
cd ~/projects/cowboybepob
npm run dev -w @cowboybepob/web
```

## الاثنين

```bash
npm run dev
```

Vite يستخدم عادة:

```text
5003
```

وAPI:

```text
5002
```

---

# 42. Logs

## API

```bash
sudo journalctl -u cowboybepob-api -n 200 --no-pager
```

متابعة مباشرة:

```bash
sudo journalctl -u cowboybepob-api -f
```

## Worker

```bash
sudo journalctl -u cowboybepob-worker -n 200 --no-pager
```

## Nginx

```bash
sudo journalctl -u nginx -n 100 --no-pager
```

## Cloudflared

```bash
sudo journalctl -u cloudflared-cowboybepob -n 200 --no-pager
```

---

# 43. فحص الخدمات

```bash
sudo systemctl status cowboybepob-api --no-pager
sudo systemctl status cowboybepob-worker --no-pager
sudo systemctl status nginx --no-pager
sudo systemctl status postgresql --no-pager
sudo systemctl status cloudflared-cowboybepob --no-pager
```

---

# 44. فحص المنافذ

```bash
sudo ss -ltnp | grep -E ':5001|:5002|:5432'
```

المتوقع:

```text
5001 -> nginx
5002 -> node/Fastify
5432 -> PostgreSQL
```

---

# 45. Health checks

API مباشرة:

```bash
curl -i http://127.0.0.1:5002/health
```

Nginx:

```bash
curl -i http://127.0.0.1:5001/health
```

الـpublic site:

```bash
curl -I https://cowboybebop.site
```

الـAPI عبر الدومين:

```bash
curl -i https://cowboybebop.site/api/v1/auth/me
```

---

# 46. Deployment الطبيعي بعد أي تعديل

هذه هي الطريقة المفضلة لأن الكود موجود على GitHub:

```bash
cd ~/projects/cowboybepob
git pull origin main
npm install
npm test
npm run typecheck
npm run build
```

ثم:

```bash
sudo systemctl restart cowboybepob-api
sudo systemctl restart cowboybepob-worker
sudo systemctl reload nginx
```

ثم:

```bash
curl -I https://cowboybebop.site
```

---

# 47. إذا التعديل Frontend فقط

لو التغيير في:

```text
apps/web/
```

نفذ:

```bash
cd ~/projects/cowboybepob
git pull origin main
npm run typecheck
npm run build
sudo systemctl reload nginx
```

لا توجد حاجة حتمية لإعادة تشغيل API/Worker إذا لم يتغير backend، لكن إعادة التشغيل ليست مشكلة إذا أردت ضمان التزامن.

---

# 48. إذا التعديل Backend

لو التغيير في:

```text
apps/api/
```

نفذ:

```bash
cd ~/projects/cowboybepob
git pull origin main
npm install
npm test
npm run typecheck
npm run build
sudo systemctl restart cowboybepob-api
sudo systemctl restart cowboybepob-worker
```

---

# 49. إذا هناك migration جديدة

يجب:

1. Pull للكود.
2. مراجعة migration.
3. Backup للـDB عند الحاجة.
4. تطبيق migration.
5. typecheck.
6. build.
7. restart services.

مثال:

```bash
cd ~/projects/cowboybepob
PGPASSWORD='DB_PASSWORD' psql \
  -h 127.0.0.1 \
  -U cowboybepob \
  -d cowboybepob \
  -f db/migrations/002_example.sql
```

**لا تعيد تشغيل `schema.sql` على قاعدة بيانات production لمجرد وجود migration جديدة.** استخدم migration.

---

# 50. Current GitHub frontend state

الـfrontend الحالي تم إصلاحه ليستخدم Routing موحد.

Commit مهم حديث:

```text
a97617572c25549dc3b01e2aeec78e665656830f
```

الملف الرئيسي الذي تم تحديثه:

```text
apps/web/src/app.tsx
```

الإصلاحات شملت:

- auth redirect
- admin routes
- subscriptions route
- catalog route
- settings route
- customer portal
- unified admin shell
- session restore
- registration flow

---

# 51. مشكلة كانت موجودة في الواجهة

كان هناك وضع تظهر فيه بعض الموارد في صفحة وتختفي من صفحة أخرى، مثل:

```text
routers
subscriptions
catalog
```

السبب كان أن الواجهة الجديدة لم تكن تربط كل الموارد في Router واحد موحد بالشكل الصحيح.

تم توحيد Admin Shell والـRoutes في:

```text
apps/web/src/app.tsx
```

والآن الـnavigation يعتمد على:

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

---

# 52. Current known limitation: manual service creation

**هذه نقطة مهمة جدًا للشخص الذي سيكمل المشروع.**

الواجهة تحتوي على عرض الخدمات والاشتراكات والـRouter ID والـConfig.

لكن لم يتم بعد اعتماد Backend endpoint كامل ومتكامل من لوحة الإدارة يقوم بعملية:

```text
Customer
  -> Plan
  -> Protocol
  -> Endpoint
  -> Router ID
  -> Service
  -> Subscription
  -> Config
  -> UUID
  -> Marzban user
  -> Job
```

بمعنى آخر:

**لا تفترض أن زر "إنشاء خدمة يدويًا" موجود ومكتمل Backend-wise.**

قبل بناء هذه الوظيفة يجب تحديد transaction واضحة تربط كل هذه الموارد، ثم enqueue job للـWorker.

---

# 53. المطلوب مستقبلاً لإنشاء Service يدويًا

المسار المقترح:

```text
Admin
 |
 v
Select Customer
 |
 v
Select Plan
 |
 v
Select Protocol/Category
 |
 v
Select Endpoint
 |
 v
Optional Router ID
 |
 v
Create Order or Admin Service action
 |
 v
DB transaction
 |
 +--> service
 +--> subscription
 +--> period
 +--> config
 +--> allocation
 +--> proxy account metadata
 |
 v
Create Job
 |
 v
Worker
 |
 v
Marzban
 |
 v
Update config/service
 |
 v
Customer Portal
```

هذه الوظيفة يجب ألا يتم تنفيذها كـfrontend-only state.

---

# 54. Config لكل عميل

في Customer Portal، الكونفيج ليس ملفًا ثابتًا داخل React.

الواجهة تطلبه من:

```text
GET /api/v1/customer/services/:id/config
```

وبالتالي يجب أن تكون الخدمة نفسها مرتبطة بـconfig حقيقي في DB.

عند إضافة provisioning جديد، يجب التأكد من أن:

```text
service
config
proxy account
subscription
allocation
```

متوافقة مع بعضها.

---

# 55. Security model

المشروع يحتوي على أساس أمني للـMVP:

- Argon2id password hashing.
- Sessions.
- CSRF double-submit.
- TOTP للـstaff.
- RBAC.
- Secret encryption.
- Audit logs.
- Cookies/session handling.
- API وUI على نفس origin في production.

لا تضف secrets إلى:

```text
Git
README
logs
frontend bundle
```

ولا ترسل Marzban credentials إلى Browser.

---

# 56. CSRF

الواجهة تحاول أخذ cookie باسم:

```text
cb_csrf
```

وعند requests غير GET تضيف:

```text
x-csrf-token
```

لذلك إذا تم تغيير auth implementation يجب الحفاظ على هذا العقد أو تحديث frontend/backend معًا.

---

# 57. CORS

في production يتم استخدام نفس الـorigin تقريبًا، لذلك:

```env
VITE_API_URL=/
```

والـNginx يقوم بتمرير:

```text
/api/
```

إلى API.

إذا تم نقل API إلى domain مستقل، يجب مراجعة:

- CORS
- cookies
- CSRF
- `COOKIE_SECURE`
- SameSite
- frontend `VITE_API_URL`

---

# 58. SPA routing

Nginx يجب أن يحتوي على:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

بدون ذلك ستظهر 404 عند فتح:

```text
/admin
/admin/routers
/admin/services
/customer
```

مباشرة من Browser.

---

# 59. Git workflow

المستخدم يريد أن تكون تعديلات الكود على GitHub مباشرة.

لذلك workflow الطبيعي:

```text
Developer
  |
  v
GitHub main
  |
  v
Server git pull
  |
  v
build/test
  |
  v
systemd/Nginx reload
```

بعد أي تعديل يجب عدم عمل تعديل يدوي دائم داخل السيرفر ثم نسيانه في GitHub.

إذا تم إصلاح شيء يدويًا على السيرفر، يجب نقله إلى repo أيضًا.

---

# 60. أمر Pull القياسي

```bash
cd ~/projects/cowboybepob
git pull origin main
```

ثم:

```bash
npm run typecheck
npm run build
```

---

# 61. Full restart command

```bash
cd ~/projects/cowboybepob

git pull origin main
npm install
npm test
npm run typecheck
npm run build

sudo systemctl restart cowboybepob-api
sudo systemctl restart cowboybepob-worker
sudo systemctl reload nginx
```

ثم:

```bash
curl -i http://127.0.0.1:5002/health
curl -i http://127.0.0.1:5001/health
curl -I https://cowboybebop.site
```

---

# 62. Troubleshooting: API down

ابدأ بـ:

```bash
sudo systemctl status cowboybepob-api --no-pager
```

ثم:

```bash
sudo journalctl -u cowboybepob-api -n 200 --no-pager
```

ثم:

```bash
curl -i http://127.0.0.1:5002/health
```

إذا API لا تعمل، افحص `.env`:

```bash
cd ~/projects/cowboybepob
ls -la .env
```

ثم تحقق من DB connectivity بدون طباعة secrets.

---

# 63. Troubleshooting: Worker down

```bash
sudo systemctl status cowboybepob-worker --no-pager
```

ثم:

```bash
sudo journalctl -u cowboybepob-worker -n 200 --no-pager
```

ثم افحص:

```bash
sudo systemctl status cowboybepob-api --no-pager
sudo systemctl status postgresql --no-pager
```

---

# 64. Troubleshooting: Nginx

```bash
sudo nginx -t
```

إذا فشل:

```bash
sudo nginx -T
```

لا تحذف config الموجود لمجرد حل المشكلة.

راجع:

```text
/etc/nginx/conf.d/
```

وخاصة إعداد Lingo Store.

---

# 65. Troubleshooting: site 502

إذا:

```bash
curl -I https://cowboybebop.site
```

يعطي 502، افحص بالترتيب:

```bash
sudo systemctl status cloudflared-cowboybepob --no-pager
sudo systemctl status nginx --no-pager
sudo ss -ltnp | grep ':5001'
curl -I http://127.0.0.1:5001
```

إذا 5001 يعمل محليًا لكن public يفشل، المشكلة غالبًا في Cloudflare Tunnel.

---

# 66. Troubleshooting: API public only fails

إذا:

```bash
curl http://127.0.0.1:5002/health
```

يعمل، لكن:

```bash
curl https://cowboybebop.site/api/v1/auth/me
```

يفشل، افحص:

```text
Nginx /api location
Cloudflare Tunnel origin
Cookie/CSRF
```

والأهم:

```bash
curl -i http://127.0.0.1:5001/health
```

---

# 67. Troubleshooting: DB

```bash
sudo systemctl status postgresql --no-pager
```

ثم:

```bash
psql "$DATABASE_URL" -c 'select 1'
```

أو باستخدام القيم المعروفة بدون طباعة `.env`:

```bash
PGPASSWORD='DB_PASSWORD' psql \
  -h 127.0.0.1 \
  -U cowboybepob \
  -d cowboybepob \
  -c 'select 1'
```

---

# 68. Troubleshooting: TypeScript

```bash
cd ~/projects/cowboybepob
npm run typecheck
```

لا تتجاوز errors بـ:

```text
as any
```

بشكل عشوائي.

أصلح الـtype contract بين API/frontend عندما يكون الخطأ حقيقيًا.

---

# 69. Troubleshooting: Build

```bash
npm run build
```

بعد build تحقق من:

```text
apps/web/dist/
```

وبعدها:

```bash
curl -I http://127.0.0.1:5001/
```

---

# 70. Docker

يوجد ملف:

```text
docker-compose.yml
```

في repository، لكن **طريقة التشغيل المعتمدة الحالية Native**.

لا تستخدم Docker على السيرفر الحالي لمجرد وجود الملف.

Native deployment يعتمد على:

```text
systemd
Nginx
PostgreSQL
Node.js
Cloudflare Tunnel
```

---

# 71. ما تم إنجازه في الـMVP

تم بناء الأساس التالي:

- React + TypeScript UI.
- Fastify + TypeScript API.
- PostgreSQL schema.
- Native deployment.
- systemd API.
- systemd Worker.
- Nginx reverse proxy.
- Cloudflare Tunnel architecture.
- Staff authentication.
- Customer registration.
- Customer login.
- Sessions.
- CSRF.
- TOTP.
- RBAC foundation.
- Customers.
- Routers.
- Servers.
- Endpoints.
- Catalog.
- Plans.
- Services.
- Configs.
- Subscriptions.
- Orders.
- Manual payments.
- Jobs.
- Audit logs.
- Marzban adapter.
- Encrypted provider credentials.
- Customer portal.
- Admin portal.
- Router ID display.
- Config retrieval.
- Architecture test.
- TypeScript validation.
- Production build.

---

# 72. الأشياء التي لم تكتمل بعد

حسب الحالة الحالية، لا تعتبر الآتي مكتملًا:

## Tailscale

لا يوجد Tailscale API/OAuth integration كامل.

## OpenWrt RouterGateway

لا يوجد `cb-remote` كامل يطبق إعدادات OpenWrt فعليًا.

## Payment Gateway

لا توجد بوابة دفع تجارية كاملة.

## Monitoring

لا يوجد Prometheus/Grafana stack كامل.

## Firmware Fleet

لا يوجد firmware management كامل.

## Automatic balancing

لا يوجد migration/load-aware balancing كامل.

## Full refund/reconciliation

لا توجد دورة refund/reconciliation كاملة.

## Manual Service Admin Provisioning

هذه نقطة العمل الرئيسية التالية: endpoint + transaction + job flow لإنشاء خدمة يدويًا من Admin مع:

```text
Customer
Plan
Protocol
Endpoint
Router ID
Service
Subscription
Config
Marzban
Job
```

---

# 73. لا تفترض وجود هذه الأشياء

الشخص الذي سيكمل المشروع يجب ألا يفترض أن الآتي موجود لمجرد وجود UI:

```text
Tailscale device automation
OpenWrt remote agent
Full payment gateway
Full manual service provisioning endpoint
Automatic endpoint balancing
Firmware management
```

إذا لم تجد endpoint واضحًا في `apps/api/src/main.ts` أو ملف backend مرتبط به، لا تبنِ frontend يوهم بأن الوظيفة تعمل.

---

# 74. Database-first rule

أي feature جديدة لها علاقة بـ:

```text
Customer
Service
Subscription
Config
Router
Order
Payment
Job
Provider
```

يجب أن تبدأ بتحديد العلاقة في PostgreSQL ثم API ثم Worker ثم UI.

لا تجعل الـfrontend هو مصدر الحقيقة.

---

# 75. Provisioning transaction rule

عند تنفيذ manual provisioning مستقبلاً، الأفضل أن تكون العملية داخل transaction بحيث لا يحدث:

```text
Service created
but subscription missing
```

أو:

```text
Subscription created
but allocation missing
```

ثم يتم إنشاء job للجزء الخارجي الخاص بـMarzban.

الـMarzban نفسه external system، لذلك لا تحاول وضع network call طويل داخل DB transaction إن كان يمكن تجنبه.

---

# 76. ترتيب القراءة لأي Developer جديد

إذا شخص جديد سيكمل المشروع، يقرأ الملفات بالترتيب:

```text
1. README.md
2. docs/OPERATIONS_RUNBOOK.md
3. db/schema.sql
4. db/migrations/
5. package.json
6. apps/api/src/main.ts
7. apps/api/src/marzban.ts
8. apps/api/src/worker.ts
9. apps/api/scripts/add-provider.mjs
10. apps/web/src/app.tsx
11. apps/web/src/styles.css
12. deploy/nginx/cowboybepob.conf
13. deploy/systemd/*.service
14. scripts/test-architecture.mjs
```

---

# 77. أول خطوات Developer جديد على السيرفر

```bash
cd ~/projects/cowboybepob

git status
git log -5 --oneline
npm install
npm test
npm run typecheck
npm run build
```

ثم:

```bash
sudo systemctl status cowboybepob-api --no-pager
sudo systemctl status cowboybepob-worker --no-pager
sudo systemctl status nginx --no-pager
sudo systemctl status postgresql --no-pager
```

ثم:

```bash
curl -i http://127.0.0.1:5002/health
curl -i http://127.0.0.1:5001/health
curl -I https://cowboybebop.site
```

---

# 78. قواعد عدم كسر السيرفر

لا تفعل:

```bash
sudo rm -rf /etc/nginx/conf.d/*
```

لا تفعل:

```bash
sudo npm install
```

لا تفعل:

```bash
sudo npm run build
```

لا تعدّل `.env` ثم تضعه في Git.

لا تضع Marzban credentials في frontend.

لا تضع Cloudflare tunnel token في Git أو documentation.

لا تحذف service الخاص بـLingo.

لا تغيّر ports بدون تحديث Nginx/systemd/Cloudflare معًا.

---

# 79. Backup قبل تغييرات DB الكبيرة

قبل migration كبيرة أو تعديل schema production، اعمل backup مناسب للبيئة.

مثال عام:

```bash
pg_dump "$DATABASE_URL" > cowboybepob-backup.sql
```

ثم نفّذ migration.

لا تعتبر `schema.sql` بديلًا عن backup.

---

# 80. Production checklist

قبل اعتبار deployment سليمًا:

```text
[ ] git pull successful
[ ] npm install successful
[ ] npm test successful
[ ] npm run typecheck successful
[ ] npm run build successful
[ ] PostgreSQL active
[ ] schema exists
[ ] migrations applied
[ ] .env exists
[ ] ENCRYPTION_KEY configured
[ ] ADMIN credentials configured
[ ] provider configured
[ ] cowboybepob-api active
[ ] cowboybepob-worker active
[ ] nginx -t successful
[ ] port 5001 listening
[ ] port 5002 listening
[ ] API /health returns 200
[ ] Nginx /health returns 200
[ ] public domain returns 200
[ ] Cloudflare tunnel active
[ ] customer registration tested
[ ] staff login tested
[ ] customer login tested
[ ] admin pages load
[ ] customer portal loads
```

---

# 81. Quick recovery sequence

إذا حصل عطل بعد deploy، استخدم:

```bash
cd ~/projects/cowboybepob

git status
git log -5 --oneline
npm run typecheck
npm run build

sudo systemctl restart cowboybepob-api
sudo systemctl restart cowboybepob-worker
sudo nginx -t
sudo systemctl reload nginx

curl -i http://127.0.0.1:5002/health
curl -i http://127.0.0.1:5001/health
curl -I https://cowboybebop.site
```

ثم logs:

```bash
sudo journalctl -u cowboybepob-api -n 200 --no-pager
sudo journalctl -u cowboybepob-worker -n 200 --no-pager
sudo journalctl -u cloudflared-cowboybepob -n 200 --no-pager
```

---

# 82. Current deployment topology summary

```text
                    INTERNET
                       |
                       v
             cowboybebop.site
                       |
                       v
                 CLOUDFLARE
                       |
                 Tunnel #2
                       |
                       v
              127.0.0.1:5001
                       |
                    NGINX
                       |
          +------------+------------+
          |                         |
          v                         v
   React static UI             /api/*
          |                         |
          |                         v
          |                   Fastify :5002
          |                         |
          |              +----------+----------+
          |              |                     |
          |              v                     v
          |        PostgreSQL :5432        Marzban
          |              ^
          |              |
          |         Worker service
          |              |
          +--------------+
```

---

# 83. Final handoff note

هذا المشروع حاليًا هو **MVP تشغيلي** وليس منصة production مكتملة بكل الـfeatures المخططة.

الأساس التشغيلي موجود:

```text
GitHub
  -> Native Ubuntu/Debian
  -> PostgreSQL
  -> Fastify API
  -> Worker
  -> Nginx
  -> Cloudflare Tunnel
  -> React Admin/Customer UI
  -> Marzban provider
```

أهم شيء عند استكماله هو الحفاظ على الفصل التالي:

```text
UI
  |
  v
API
  |
  v
PostgreSQL
  |
  v
Jobs
  |
  v
Worker
  |
  v
External Providers
```

ولا تجعل React ينفذ provisioning مباشرًا إلى Marzban.

---

# 84. الأوامر التي يحتاجها الشخص غالبًا فقط

## تحديث المشروع

```bash
cd ~/projects/cowboybepob
git pull origin main
```

## فحص

```bash
npm test
npm run typecheck
npm run build
```

## Restart

```bash
sudo systemctl restart cowboybepob-api
sudo systemctl restart cowboybepob-worker
sudo systemctl reload nginx
```

## Health

```bash
curl -i http://127.0.0.1:5002/health
curl -i http://127.0.0.1:5001/health
curl -I https://cowboybebop.site
```

## Logs

```bash
sudo journalctl -u cowboybepob-api -n 200 --no-pager
sudo journalctl -u cowboybepob-worker -n 200 --no-pager
```

## Full audit

```bash
cd ~/projects/cowboybepob
bash deploy/audit-native.sh
```

---

# 85. آخر قاعدة

أي شخص يكمل المشروع يجب أن يعتبر هذا الملف و`README.md` نقطة البداية، ثم يتحقق من الكود الفعلي قبل افتراض أن feature موجودة.

إذا تعارضت هذه الوثيقة مع الكود الحالي، **الكود الحالي هو المصدر التنفيذي للحقيقة**، ويجب تحديث هذه الوثيقة بعد إصلاح الاختلاف.
