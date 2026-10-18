# CowboyBepob Platform — Native MVP

منصة MVP لإدارة وبيع خدمات Proxy/Subscriptions والراوترات، مبنية على `SITE_ARCHITECTURE.md` وتعمل Native على Ubuntu/Debian بدون Docker.

## الحالة الحالية

- React + TypeScript للواجهة.
- Fastify + TypeScript للـAPI.
- PostgreSQL للحالة التجارية.
- Worker مستقل لمعالجة الـjobs باستخدام `FOR UPDATE SKIP LOCKED`.
- Admin Panel وCustomer Portal بالعربية وRTL.
- Staff/Customer authentication، Argon2id، sessions، CSRF، TOTP وRBAC.
- Catalog: categories / plans / router products.
- Customers / services / configs / subscriptions / allocations.
- Orders مع `Idempotency-Key`.
- Manual payments + webhook foundation.
- Marzban provisioning adapter مع credentials مشفرة داخل PostgreSQL.
- Router inventory/lifecycle.
- Server hosts/endpoints.
- Audit log.
- Nginx + systemd native deployment.

## ما زال خارج MVP

- Tailscale API/OAuth وربط الأجهزة الحقيقي.
- RouterGateway / `cb-remote` وتطبيق إعدادات OpenWrt فعليًا.
- Payment gateway تجاري كامل.
- Monitoring/Prometheus/Grafana.
- Firmware fleet management.
- Automatic migration/load-aware balancing الكامل.
- Full refund/reconciliation workflows.

## المنافذ

- `5001` — Nginx / الموقع العام وAdmin/Customer UI.
- `5002` — Fastify API على `127.0.0.1`.
- `5003` — Vite أثناء التطوير.
- `5432` — PostgreSQL.
- `8000` — Marzban في السيرفر المنفصل حسب إعدادك.

Marzban ليس جزءًا من خادم التطبيق. الـAPI والـworker يتعاملان معه عبر `provider_instances`.

## المتطلبات

- Ubuntu/Debian.
- Node.js 22 أو أحدث.
- PostgreSQL.
- Nginx.
- حساب Linux الموجود `abdulrahman`.
- مشروع التطبيق في `/home/abdulrahman/projects/cowboybepob`.

## إعداد PostgreSQL

أنشئ قاعدة البيانات والمستخدم حسب إعداد السيرفر:

```bash
sudo -u postgres psql
```

```sql
CREATE USER cowboybepob WITH PASSWORD 'CHANGE_THIS_PASSWORD';
CREATE DATABASE cowboybepob OWNER cowboybepob;
\q
```

طبّق الـschema:

```bash
cd ~/projects/cowboybepob
PGPASSWORD='CHANGE_THIS_PASSWORD' psql -h 127.0.0.1 -U cowboybepob -d cowboybepob -f db/schema.sql
```

وطبّق migrations الموجودة:

```bash
PGPASSWORD='CHANGE_THIS_PASSWORD' psql -h 127.0.0.1 -U cowboybepob -d cowboybepob -f db/migrations/001_provider_credentials.sql
```

## Environment

ملف `.env` داخل المشروع ومملوك لـ`abdulrahman`:

```bash
cd ~/projects/cowboybepob
cp .env.example .env
nano .env
```

استخدم:

```env
NODE_ENV=production
PORT=5002
DATABASE_URL=postgres://cowboybepob:CHANGE_THIS_PASSWORD@127.0.0.1:5432/cowboybepob
CORS_ORIGIN=http://SERVER_IP:5001
COOKIE_SECURE=false
SESSION_DAYS=7
ENCRYPTION_KEY=RANDOM_32_BYTE_SECRET
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=STRONG_ADMIN_PASSWORD
ADMIN_TOTP_SECRET=BASE32_TOTP_SECRET
VITE_API_URL=/
```

لا تضع `MARZBAN_USERNAME` أو `MARZBAN_PASSWORD` أو `MARZBAN_BASE_URL` في `.env`. بيانات دخول Marzban تُخزن مشفرة داخل `provider_instances`.

## التحقق من الكود قبل التشغيل

كل أوامر المشروع تعمل كمستخدم `abdulrahman`:

```bash
cd ~/projects/cowboybepob
npm install
npm test
npm run typecheck
npm run build
```

## إضافة Marzban Provider

بعد ضبط `.env` وتطبيق migration:

```bash
cd ~/projects/cowboybepob
npm run provider:add -- \
  --name="Default Marzban" \
  --url="http://MARZBAN_SERVER:8000" \
  --username="MARZBAN_USERNAME" \
  --password="MARZBAN_PASSWORD"
```

بيانات الدخول لا تُحفظ في `.env`.

## إعداد systemd

الخدمتان تعملان بالكامل كمستخدم `abdulrahman`:

```bash
sudo cp deploy/systemd/cowboybepob-api.service /etc/systemd/system/
sudo cp deploy/systemd/cowboybepob-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cowboybepob-api cowboybepob-worker
```

## إعداد Nginx

إعداد CowboyBepob يضاف إلى `conf.d` ولا يحذف أو يستبدل إعدادات Nginx الموجودة:

```bash
sudo cp deploy/nginx/cowboybepob.conf /etc/nginx/conf.d/cowboybepob.conf
sudo nginx -t
sudo systemctl reload nginx
```

هذا مهم إذا كان Lingo Store أو أي موقع آخر يعمل على نفس Nginx.

## التحقق بعد التشغيل

```bash
curl http://127.0.0.1:5002/health
curl http://127.0.0.1:5001/health
curl -I http://127.0.0.1:5001/

sudo systemctl --no-pager status cowboybepob-api
sudo systemctl --no-pager status cowboybepob-worker
sudo nginx -t
```

الموقع يكون على:

```text
http://SERVER_IP:5001
```

## Audit كامل

```bash
cd ~/projects/cowboybepob
deploy/audit-native.sh
```

الـaudit يفحص ownership، Node، PostgreSQL، Nginx، systemd، health، ports، typecheck وbuild.

## Logs

```bash
sudo journalctl -u cowboybepob-api -n 200 --no-pager
sudo journalctl -u cowboybepob-worker -n 200 --no-pager
sudo journalctl -u nginx -n 100 --no-pager
```

## Development بدون Containers

API:

```bash
cd ~/projects/cowboybepob
npm run dev -w @cowboybepob/api
```

Web:

```bash
npm run dev -w @cowboybepob/web
```

## Provisioning

لكي ينجح تخصيص خدمة، يجب وجود `server_endpoint` فعال مرتبط بالفئة عبر `category_endpoints`، ويجب أن يطابق `provider_inbound_tag` الـinbound الحقيقي في Marzban.

الـworker يختار endpoint لديه capacity ويستخدم مدة الخطة، ثم ينشئ/يحدّث مستخدم Marzban ويحوّل الـconfig إلى VLESS/VMess link عند السماح بذلك.

## ملاحظات مهمة

- لا تشغّل أوامر npm بصلاحيات root.
- ملكية المشروع والـ`.env` يجب أن تبقى `abdulrahman:abdulrahman`.
- `sudo` يستخدم فقط لأوامر النظام مثل systemd وNginx وPostgreSQL.
- لا تستخدم `sudo -u cowboybepob`؛ لا يوجد service user منفصل في هذا التصميم.
- لا تحذف إعدادات Nginx الموجودة على السيرفر.

<!-- final quota pricing workflow trigger v10 -->
