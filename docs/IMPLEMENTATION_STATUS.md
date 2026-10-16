# حالة التنفيذ — MVP Audit

آخر مراجعة: 2026-10-16

## الهدف

الهدف هو تشغيل `cowboybepob-site` كمنصة Native على Ubuntu/Debian بدون Docker، مع الالتزام بالـ`SITE_ARCHITECTURE.md` قدر الإمكان ضمن MVP قابل للتجربة.

## ما تم تنفيذه

### Core
- Monorepo: `apps/web` + `apps/api`.
- PostgreSQL schema يغطي customers, staff, sessions, providers, hosts, endpoints, catalog, routers, Tailscale devices, services, configs, allocations, subscriptions, orders, payments, jobs, audit.
- Fastify API + worker منفصل.
- DB-backed jobs مع `FOR UPDATE SKIP LOCKED` وretry/backoff.

### Authentication / Security
- Customer/staff login.
- Argon2id password hashing.
- Staff TOTP.
- Session cookies.
- CSRF double-submit.
- RBAC للأدوار الرئيسية.
- AES-256-GCM لتشفير الأسرار في DB.
- Rate limiting على API/login.
- Audit events لعمليات حساسة.

### Business MVP
- Catalog categories/plans/router products.
- Customer registration/profile.
- Customer services/subscriptions.
- Customer orders مع `Idempotency-Key`.
- Manual payment.
- Payment event/webhook foundation.
- Fulfillment/provisioning jobs.
- Marzban create/update/disable/enable/delete/usage.
- Router inventory/lifecycle.
- Server hosts/endpoints.
- Admin customers/services/routers/servers/catalog/orders/payments/jobs/audit.

### Native deployment
- Nginx public entrypoint: `5001`.
- Fastify API: `127.0.0.1:5002`.
- Vite development server: `5003`.
- systemd API + worker.
- Native installer.
- PostgreSQL local.
- لا يحتاج Docker لتشغيل الـMVP.

## نتائج الـAudit الحالية

### P0 — يجب التأكد منه على السيرفر
- تشغيل `npm run typecheck` و`npm run build` على نفس نسخة Node الموجودة على السيرفر.
- استيراد `db/schema.sql` قبل تشغيل API.
- ضبط `ENCRYPTION_KEY` وبيانات Admin/TOTP.
- التأكد من اتصال API بـPostgreSQL وMarzban.

### P1 — تكاملات خارجية غير مكتملة في الـMVP
- Tailscale OAuth/API وربط الأجهزة فعليًا.
- RouterGateway / `cb-remote` لتطبيق إعدادات OpenWrt فعليًا.
- Payment gateway تجاري حقيقي؛ الموجود manual + webhook foundation.
- Monitoring/Prometheus/Grafana.
- Firmware fleet management.
- Automatic migration/load-aware balancing.

### P1 — Business hardening
- Versioned DB migrations بدل الاعتماد على init schema فقط.
- Background reconciliation دوري مع Marzban.
- Usage sync دوري من Marzban إلى subscriptions.
- Refund workflow كامل.
- Staff management write UI/API.
- Secret reveal policy أكثر تقييدًا مع logging إضافي.

### P1 — UI
- بعض صفحات الإدارة الحالية هي data views أولية وليست CRUD كاملة لكل كيان.
- أزرار `Add` في بعض الصفحات تحتاج dialogs/forms وربطًا مباشرًا بالـPOST endpoints.
- إعدادات Tailscale/Provider وCategory↔Endpoint تحتاج واجهة إدارة مخصصة.

## قرار الـMVP

المشروع صالح كأساس MVP Native، لكنه لا يُعتبر Production Complete قبل تنفيذ اختبارات السيرفر الفعلية والتكاملات المذكورة أعلاه.

الـMVP التشغيلي المقصود:

```text
Customer
  -> Catalog
  -> Order
  -> Manual Payment
  -> DB Job
  -> Allocation
  -> Marzban Provisioning
  -> Service ACTIVE
  -> Config retrieval
```

والراوترات تبقى inventory + lifecycle في الـMVP، بينما الإدارة الفعلية عبر Tailscale/OpenWrt Gateway مرحلة تكامل لاحقة.
