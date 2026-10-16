# CowboyBepob Platform

منصة إدارة بيع خدمات Proxy/Subscriptions وأجهزة OpenWrt، مبنية وفق `SITE_ARCHITECTURE.md` داخل المشروع.

## المكونات

- React + TypeScript + Vite: Admin / Customer UI، RTL.
- Fastify + TypeScript: REST API تحت `/api/v1`.
- PostgreSQL 16: مصدر الحقيقة للـbusiness state.
- DB-backed worker: `FOR UPDATE SKIP LOCKED`، provisioning/retry/expiry.
- Marzban adapter: token auth، create/update/get/disable/delete/usage/health.
- Sessions: httpOnly cookie + CSRF double-submit، Argon2id، Staff TOTP.
- RBAC: SUPER_ADMIN / ADMIN / SUPPORT / TECHNICIAN / FINANCE.
- Secrets: application-level AES-256-GCM for client credentials.
- Audit: append-only application audit rows.
- Docker Compose: DB + API + Worker + Web.

## التشغيل المحلي

```bash
cp .env.example .env
# عدّل الأسرار والقيم في .env
npm install
npm run typecheck
npm run build
docker compose up -d --build
```

الواجهة: `http://localhost:5173`
API: `http://localhost:4000/health`

## إعداد Marzban

ضع:

```env
MARZBAN_BASE_URL=https://marzban.example.com
MARZBAN_USERNAME=admin
MARZBAN_PASSWORD=...
```

الـadapter يستخدم `POST /api/admin/token` ثم `/api/user` و`/api/user/{username}`. يجب أن تتطابق أسماء الـinbounds مع `provider_inbound_tag` في الـendpoint.

## أول حساب Admin

عند أول تشغيل، إذا كان `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_TOTP_SECRET` موجودين، ينشئ API حساب `SUPER_ADMIN` مرة واحدة.

لا تضع الأسرار داخل Git.

## نشر على Debian/Ubuntu

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
exit
```

بعد إعادة الدخول:

```bash
git clone https://github.com/adourix/cowboybepob-site.git
cd cowboybepob-site
cp .env.example .env
nano .env
docker compose up -d --build
docker compose ps
docker compose logs -f api worker
```

للـproduction خلف reverse proxy:

- اجعل `COOKIE_SECURE=true`.
- اجعل `CORS_ORIGIN=https://panel.example.com`.
- لا تفتح PostgreSQL للعامة.
- لا تفتح منفذ API للعامة إذا كان Nginx/Traefik هو المدخل الوحيد.
- قيّد Admin panel عبر allowlist/Tailscale حسب التصميم.

## التشغيل بدون Docker أثناء التطوير

```bash
npm install
npm run dev
```

يتطلب PostgreSQL متاحًا على `DATABASE_URL`.

## فحص الحالة

```bash
curl http://127.0.0.1:4000/health
docker compose ps
docker compose logs --tail=100 api
docker compose logs --tail=100 worker
```

## مسار الشراء

1. Customer يختار Plan.
2. `POST /api/v1/customer/orders` مع `Idempotency-Key`.
3. Order = `PENDING_PAYMENT`.
4. Payment webhook أو Manual payment يحول الطلب إلى `PAID` ويضيف Job.
5. Worker ينشئ Service + Subscription + Allocation + Config + ProxyAccount داخل transaction.
6. Worker يستدعي Marzban خارج transaction.
7. نجاح provider يحول allocation/config/service إلى ACTIVE/CURRENT.
8. Expiry sweep يدير EXPIRED ثم retention.

## API المبدئي

### Auth

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `POST /api/v1/customer/auth/register`

### Customer

- `/api/v1/customer/profile`
- `/api/v1/customer/catalog/categories`
- `/api/v1/customer/services`
- `/api/v1/customer/services/:id/config`
- `/api/v1/customer/services/:id/renew`
- `/api/v1/customer/routers`
- `/api/v1/customer/routers/:id/replacement-requests`
- `/api/v1/customer/orders`
- `/api/v1/customer/orders/:id/pay`

### Admin

- dashboard
- customers
- services
- routers
- servers / hosts / endpoints
- catalog
- orders
- payments / manual payments
- jobs / retry
- audit logs
- provider instances
- staff users
- settings

## ملاحظات مهمة

- لا يتم تسجيل VMess/VLESS URLs أو UUIDs في logs.
- Customer DTOs لا تعرض Marzban/Tailscale/internal endpoint data.
- Revealing a client config هو secret action ويجب أن يكون مدعومًا بالصلاحية المناسبة في production.
- Router management/Tailscale يحتاج adapter مستقل قبل تشغيله على أجهزة حقيقية.
- Payment gateway الحقيقي يحتاج implementation منفصل للتحقق من signature ثم fetch transaction من gateway.
