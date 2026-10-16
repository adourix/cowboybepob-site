# CowboyBepob Platform

منصة MVP لبيع وإدارة خدمات Proxy/Subscriptions وأجهزة OpenWrt، مبنية على `SITE_ARCHITECTURE.md`.

**النشر الأساسي هنا Native على Ubuntu/Debian، بدون Docker أو Containers.**

## ما يغطيه الـMVP

- Admin panel وCustomer portal باللغة العربية وRTL.
- Customer/Staff authentication، sessions، CSRF، Argon2id، وTOTP للموظفين.
- RBAC للأدوار: SUPER_ADMIN / ADMIN / SUPPORT / TECHNICIAN / FINANCE.
- PostgreSQL كمصدر الحقيقة للـbusiness state.
- Catalog: categories + plans + router products.
- Customers، services، subscriptions، configs، allocations.
- Orders + manual payment foundation + payment events.
- DB-backed jobs/worker باستخدام `FOR UPDATE SKIP LOCKED`.
- Marzban adapter للـprovisioning والـusage/health.
- Routers + Tailscale data model وواجهات الإدارة الأساسية.
- Audit log.
- Nginx same-origin: `/` للواجهة و`/api` للـAPI.
- systemd لخدمتي API وWorker.

الـArchitecture نفسه يحدد أن التطبيق DB هو مصدر الحقيقة، بينما Marzban يحتفظ بالمستخدمين والحالة التشغيلية، وأن Tailscale قناة إدارة فقط للراوترات. fileciteturn234file0L50-L105

## البنية

```text
Browser
   │
   ▼
 Nginx :80/443
   ├── /              → apps/web/dist
   └── /api/*         → 127.0.0.1:4000
                            │
                            ▼
                       Fastify API
                            │
                            ▼
                       PostgreSQL
                            ▲
                            │
                    systemd Worker
                            │
                  ┌─────────┴─────────┐
                  ▼                   ▼
               Marzban            Tailscale
```

## متطلبات السيرفر

- Ubuntu 22.04/24.04 أو Debian حديث.
- Node.js 20+ وnpm.
- PostgreSQL 15+.
- Nginx.
- Marzban متاح من السيرفر إذا أردت provisioning حقيقي.
- Tailscale مطلوب فقط عندما نبدأ إدارة الراوترات فعليًا.

## 1. تثبيت Node.js 20+

إذا كان Node موجودًا:

```bash
node -v
npm -v
```

المطلوب `node >= 20`.

على Ubuntu/Debian يمكن تثبيت Node.js 20 عبر NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

## 2. PostgreSQL

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib nginx git build-essential curl ca-certificates
sudo systemctl enable --now postgresql nginx
```

أنشئ مستخدم وقاعدة البيانات:

```bash
sudo -u postgres psql
```

داخل psql:

```sql
CREATE USER cowboybepob WITH PASSWORD 'ضع_كلمة_مرور_قوية_هنا';
CREATE DATABASE cowboybepob OWNER cowboybepob;
\q
```

ثم طبّق الـschema:

```bash
cd /var/www/cowboybepob
tail -n +1 db/schema.sql | PGPASSWORD='ضع_كلمة_مرور_قوية_هنا' psql -h 127.0.0.1 -U cowboybepob -d cowboybepob
```

## 3. تنزيل المشروع

```bash
sudo mkdir -p /var/www
sudo git clone https://github.com/adourix/cowboybepob-site.git /var/www/cowboybepob
sudo chown -R "$USER":"$USER" /var/www/cowboybepob
cd /var/www/cowboybepob
```

## 4. Environment

```bash
sudo mkdir -p /etc/cowboybepob
sudo nano /etc/cowboybepob/site.env
```

استخدم:

```env
NODE_ENV=production
PORT=4000
DATABASE_URL=postgres://cowboybepob:DB_PASSWORD@127.0.0.1:5432/cowboybepob
CORS_ORIGIN=https://panel.example.com
COOKIE_SECURE=true
SESSION_DAYS=7
ENCRYPTION_KEY=RANDOM_SECRET
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=STRONG_ADMIN_PASSWORD
ADMIN_TOTP_SECRET=BASE32_TOTP_SECRET
MARZBAN_BASE_URL=http://127.0.0.1:8000
MARZBAN_USERNAME=admin
MARZBAN_PASSWORD=MARZBAN_PASSWORD
VITE_API_URL=/
```

توليد الأسرار:

```bash
openssl rand -hex 32
python3 -c "import base64,os; print(base64.b32encode(os.urandom(20)).decode().rstrip('='))"
```

لا تضع `site.env` داخل Git.

## 5. تثبيت Node dependencies وبناء الموقع

```bash
cd /var/www/cowboybepob
npm install
npm run typecheck
npm run build
```

## 6. تشغيل الـAPI والـWorker بدون Containers

أنشئ مستخدم الخدمة:

```bash
sudo useradd --system --create-home --home-dir /var/lib/cowboybepob --shell /usr/sbin/nologin cowboybepob || true
sudo chown -R cowboybepob:cowboybepob /var/www/cowboybepob
```

ثبّت systemd units:

```bash
sudo cp deploy/systemd/cowboybepob-api.service /etc/systemd/system/
sudo cp deploy/systemd/cowboybepob-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cowboybepob-api cowboybepob-worker
```

تحقق:

```bash
sudo systemctl status cowboybepob-api --no-pager
sudo systemctl status cowboybepob-worker --no-pager
curl http://127.0.0.1:4000/health
```

Logs:

```bash
sudo journalctl -u cowboybepob-api -f
sudo journalctl -u cowboybepob-worker -f
```

## 7. Nginx

```bash
sudo cp deploy/nginx/cowboybepob.conf /etc/nginx/sites-available/cowboybepob.conf
sudo ln -sfn /etc/nginx/sites-available/cowboybepob.conf /etc/nginx/sites-enabled/cowboybepob.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

الـNginx config يفترض أن الموقع مبني في:

```text
/var/www/cowboybepob/apps/web/dist
```

وأن الـAPI يستمع على:

```text
127.0.0.1:4000
```

في الإنتاج استخدم domain حقيقي وHTTPS، واضبط `server_name` و`CORS_ORIGIN` accordingly.

## 8. أول دخول Admin

عند أول تشغيل للـAPI، إذا كانت:

```env
ADMIN_EMAIL
ADMIN_PASSWORD
ADMIN_TOTP_SECRET
```

موجودة، يتم إنشاء `SUPER_ADMIN` مرة واحدة.

بعد ذلك:

```text
https://panel.example.com/login
```

وتختار "الموظفون" وتستخدم البريد + كلمة المرور + TOTP.

## 9. تطوير محلي بدون Containers

Terminal 1:

```bash
export DATABASE_URL='postgres://cowboybepob:password@127.0.0.1:5432/cowboybepob'
npm run dev -w @cowboybepob/api
```

Terminal 2:

```bash
npm run dev -w @cowboybepob/web
```

Vite يمرر `/api` إلى `127.0.0.1:4000`.

## 10. Marzban

```env
MARZBAN_BASE_URL=http://127.0.0.1:8000
MARZBAN_USERNAME=admin
MARZBAN_PASSWORD=...
```

الـadapter يستخدم token endpoint ثم user endpoints في Marzban. يجب أن يطابق `provider_inbound_tag` الـinbound الحقيقي في Marzban.

إذا كان Marzban على سيرفر آخر، استخدم عنوانه الشبكي بدل `127.0.0.1`.

## 11. مسار الـMVP

```text
Customer
  ↓
Catalog
  ↓
POST Order + Idempotency-Key
  ↓
Payment / Manual Payment
  ↓
Job QUEUED
  ↓
Worker
  ↓
Service + Subscription + Allocation + Config
  ↓
Marzban provisioning
  ↓
ACTIVE
```

الـarchitecture يشترط إنشاء Service/Subscription/allocation reservation قبل استدعاء provider، وأن استدعاءات Marzban/Tailscale لا تتم داخل transaction HTTP. fileciteturn234file0L28-L46 fileciteturn233file4L327-L360

## 12. نطاق الراوترات في الـMVP

الموديل يدعم:

- Router lifecycle: `IN_STOCK → ASSIGNED → PROVISIONING → READY`.
- Connectivity منفصلة: `ONLINE/OFFLINE/UNKNOWN`.
- Router واحد كحد أقصى لكل service في الـMVP.
- Tailscale device linking.
- Replacement requests.

هذا متوافق مع التصميم الذي يفصل lifecycle عن connectivity ويضع قاعدة service واحدة لكل router في الـMVP. fileciteturn234file1L262-L341

## 13. ما ليس جزءًا من MVP النهائي

هذه أجزاء مؤجلة في الـarchitecture نفسه أو تحتاج قرارًا/تكاملًا خارجيًا:

- Payment gateway حقيقي بدل manual payment.
- Tailscale OAuth/API credentials الفعلية وربط أجهزة الإنتاج.
- RouterGateway الفعلي عبر tailnet و`cb-remote`.
- Automatic migration/load-aware balancing.
- Prometheus/Grafana.
- Firmware fleet management.
- عدة services على نفس router.

الـarchitecture يضع هذه ضمن المستقبل أو مراحل hardening/integration. fileciteturn233file2L177-L199

## 14. تحديث المشروع

```bash
cd /var/www/cowboybepob
git pull --ff-only
npm install
npm run typecheck
npm run build
sudo systemctl restart cowboybepob-api cowboybepob-worker
sudo systemctl reload nginx
```

## 15. فحص كامل

```bash
curl -f http://127.0.0.1:4000/health
curl -I http://127.0.0.1/
sudo systemctl --no-pager --full status cowboybepob-api
sudo systemctl --no-pager --full status cowboybepob-worker
sudo nginx -t
```

لا تحتاج Docker لتشغيل هذا المشروع.
