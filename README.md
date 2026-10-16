# CowboyBepob Platform — Native MVP

منصة MVP لإدارة وبيع خدمات Proxy/Subscriptions والراوترات، مبنية على `SITE_ARCHITECTURE.md` وتعمل **Native على Ubuntu/Debian بدون Docker**.

## منافذ التشغيل

- `5001` — Nginx / الموقع العام
- `5002` — Fastify API على `127.0.0.1`
- `5003` — Vite أثناء التطوير
- `5432` — PostgreSQL
- `8000` — Marzban حسب إعدادك

## MVP الموجود

- Admin Panel وCustomer Portal بالعربية وRTL.
- Staff/Customer authentication، Argon2id، sessions، CSRF، TOTP وRBAC.
- PostgreSQL business state.
- Catalog: categories / plans / router products.
- Customers / services / configs / subscriptions / allocations.
- Orders مع `Idempotency-Key`.
- Manual payments + payment events/webhook foundation.
- DB worker مع `FOR UPDATE SKIP LOCKED` وretry/backoff.
- Marzban provisioning adapter.
- Router inventory/lifecycle.
- Server hosts/endpoints.
- Audit log.
- Nginx + systemd native deployment.

## المؤجل خارج MVP

- Tailscale API/OAuth وربط الأجهزة الحقيقي.
- RouterGateway / `cb-remote` وتطبيق إعدادات OpenWrt فعليًا.
- Payment gateway تجاري كامل.
- Monitoring/Prometheus/Grafana.
- Firmware fleet management.
- Automatic migration/load-aware balancing.
- Versioned DB migrations.
- Full refund/reconciliation workflows.

## التثبيت

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential nginx postgresql postgresql-contrib openssl python3
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo mkdir -p /var/www
sudo git clone https://github.com/adourix/cowboybepob-site.git /var/www/cowboybepob
cd /var/www/cowboybepob
```

PostgreSQL:

```bash
sudo -u postgres psql
```

```sql
CREATE USER cowboybepob WITH PASSWORD 'CHANGE_THIS_PASSWORD';
CREATE DATABASE cowboybepob OWNER cowboybepob;
\q
```

```bash
PGPASSWORD='CHANGE_THIS_PASSWORD' psql -h 127.0.0.1 -U cowboybepob -d cowboybepob -f db/schema.sql
```

Environment:

```bash
sudo mkdir -p /etc/cowboybepob
sudo nano /etc/cowboybepob/site.env
```

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
MARZBAN_BASE_URL=http://127.0.0.1:8000
MARZBAN_USERNAME=admin
MARZBAN_PASSWORD=MARZBAN_PASSWORD
VITE_API_URL=/
```

Build:

```bash
sudo useradd --system --create-home --home-dir /var/lib/cowboybepob --shell /usr/sbin/nologin cowboybepob || true
sudo chown -R cowboybepob:cowboybepob /var/www/cowboybepob
sudo -u cowboybepob bash -lc 'cd /var/www/cowboybepob && npm install && npm run typecheck && npm run build'
```

Install services:

```bash
sudo cp deploy/systemd/cowboybepob-api.service /etc/systemd/system/
sudo cp deploy/systemd/cowboybepob-worker.service /etc/systemd/system/
sudo cp deploy/nginx/cowboybepob.conf /etc/nginx/sites-available/cowboybepob.conf
sudo ln -sfn /etc/nginx/sites-available/cowboybepob.conf /etc/nginx/sites-enabled/cowboybepob.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl daemon-reload
sudo nginx -t
sudo systemctl enable --now cowboybepob-api cowboybepob-worker nginx
```

## التحقق

```bash
curl http://127.0.0.1:5002/health
curl http://127.0.0.1:5001/health
curl -I http://127.0.0.1:5001/
sudo systemctl --no-pager status cowboybepob-api
sudo systemctl --no-pager status cowboybepob-worker
sudo nginx -t
```

## Audit كامل

```bash
cd /var/www/cowboybepob
sudo chmod +x deploy/audit-native.sh
sudo deploy/audit-native.sh
```

## Logs

```bash
sudo journalctl -u cowboybepob-api -n 200 --no-pager
sudo journalctl -u cowboybepob-worker -n 200 --no-pager
sudo journalctl -u nginx -n 100 --no-pager
```

## Development بدون Containers

API على `5002`:

```bash
cd /var/www/cowboybepob
export DATABASE_URL='postgres://cowboybepob:PASSWORD@127.0.0.1:5432/cowboybepob'
export PORT=5002
npm run dev -w @cowboybepob/api
```

Web على `5003`:

```bash
npm run dev -w @cowboybepob/web
```

## ملاحظة provisioning

لكي ينجح تخصيص خدمة، يجب أن يكون هناك `server_endpoint` فعال مرتبط بالفئة عبر `category_endpoints`، وأن يطابق `provider_inbound_tag` الـinbound الحقيقي في Marzban. بدون endpoint مرتبط، الـworker لن يستطيع عمل allocation.

راجع `docs/IMPLEMENTATION_STATUS.md` قبل اعتبار النظام Production Complete.
