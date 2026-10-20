# CowboyBepob

> **Native self-hosted platform for subscriptions, proxy services, routers, provisioning, payments, and customer operations.**

CowboyBepob is the backend platform behind the CowboyBepob service marketplace. It combines a customer portal, staff/admin operations, subscription and service lifecycle management, router inventory, provider provisioning, wallet-payment ingestion, and native Linux deployment in one application.

The platform is designed to run directly on **Ubuntu/Debian without Docker** and to keep the commercial state in PostgreSQL while integrating external infrastructure through explicit provider/endpoint boundaries.

---

## Table of Contents

- [What CowboyBepob Does](#what-cowboybepob-does)
- [Architecture](#architecture)
- [Core Modules](#core-modules)
- [Payment & Wallet SMS Engine](#payment--wallet-sms-engine)
- [Provisioning](#provisioning)
- [Authentication & Security](#authentication--security)
- [Repository Structure](#repository-structure)
- [Runtime Ports](#runtime-ports)
- [Requirements](#requirements)
- [Environment](#environment)
- [Database](#database)
- [Local Development](#local-development)
- [Production Deployment](#production-deployment)
- [Operations](#operations)
- [Testing & Validation](#testing--validation)
- [Troubleshooting](#troubleshooting)
- [Current Scope](#current-scope)
- [Roadmap](#roadmap)
- [Documentation](#documentation)

---

## What CowboyBepob Does

### Customer side

- Browse service plans and router products.
- Create and manage orders.
- Manage active services and configurations.
- View subscription/configuration state.
- Connect services to routers.
- Use customer authentication and account management.

### Staff/Admin side

- Manage customers, services, configs, plans, categories, and router products.
- Manage router inventory and lifecycle.
- Manage provider instances and server endpoints.
- Review payments and incoming wallet SMS messages.
- Review unmatched/manual-review transactions.
- Inspect audit activity.
- Manage staff accounts and roles.

### Infrastructure side

- Provision subscriptions through provider adapters.
- Integrate with Marzban through stored provider instances.
- Keep provider credentials encrypted in PostgreSQL.
- Run API and background jobs as separate systemd services.
- Serve the web application through Nginx.
- Operate directly on Ubuntu/Debian without a container runtime.

---

## Architecture

```text
                         ┌─────────────────────────┐
                         │       Customer UI        │
                         │     React + TypeScript   │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │        Nginx :5001      │
                         │   Web + reverse proxy   │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │     Fastify API :5002   │
                         │     TypeScript backend  │
                         └───────┬────────┬────────┘
                                 │        │
                 ┌───────────────┘        └────────────────┐
                 │                                         │
        ┌────────▼────────┐                       ┌────────▼────────┐
        │   PostgreSQL    │                       │   Worker        │
        │ commercial state│                       │ background jobs │
        └─────────────────┘                       └────────┬────────┘
                                                          │
                                     ┌────────────────────┼────────────────────┐
                                     │                    │                    │
                              ┌──────▼──────┐      ┌─────▼──────┐      ┌─────▼──────┐
                              │   Marzban   │      │   Wallet   │      │   Routers  │
                              │  provider   │      │ SMS input  │      │ / inventory│
                              └─────────────┘      └────────────┘      └────────────┘
```

### Architectural principles

1. **PostgreSQL is the commercial source of truth.**
2. **External infrastructure is accessed through explicit adapters/providers.**
3. **API and worker responsibilities are separated.**
4. **Provisioning is asynchronous and capacity-aware.**
5. **Payment ingestion is parsed, persisted, matched, and audited rather than directly trusting a client-side confirmation.**
6. **Production deployment is native Linux using systemd + Nginx.**
7. **Secrets and provider credentials are not committed to Git.**

---

## Core Modules

| Module | Responsibility |
|---|---|
| **Customer Portal** | Customer-facing services, configurations, orders, routers, and account flows |
| **Admin Panel** | Operations, catalog, customers, services, routers, providers, payments, and audit |
| **Catalog** | Categories, plans, service definitions, router products |
| **Services** | Service lifecycle, configurations, subscriptions, allocations |
| **Orders** | Customer orders with idempotency protection |
| **Provisioning** | Provider abstraction and background provisioning jobs |
| **Marzban Adapter** | Create/update provider-side subscriptions/configurations |
| **Router Inventory** | Router registration, inventory, lifecycle and assignment state |
| **Payments** | Payment records, wallet SMS ingestion, parsing, matching and review |
| **Authentication** | Customer/staff auth, sessions, CSRF, TOTP and RBAC |
| **Audit** | Operational and security activity trail |
| **Deployment** | Native systemd/Nginx production runtime |

---

# Payment & Wallet SMS Engine

CowboyBepob supports wallet-payment ingestion through the existing payment pipeline.

```text
Wallet SMS / Admin Paste / Device
                │
                ▼
        SMS ingestion endpoint
                │
                ▼
        Wallet SMS classifier
                │
                ▼
          Parser / normalizer
                │
        ┌───────┴────────┐
        │                │
     Parsed           Failed
        │                │
        ▼                ▼
   payment_sms      Manual review
        │
        ▼
      Matcher
        │
   ┌────┴────┐
   │         │
Matched   Unmatched
   │         │
   ▼         ▼
Payment    Review
```

### Parser design

The parser is intentionally **data-first rather than provider-first**.

It extracts transaction information from the message structure instead of assuming that one phrase uniquely identifies a provider.

Supported concepts include:

- Amount.
- Sender wallet when a phone number exists.
- Sender name when a name is provided instead of a number.
- Receiving wallet when present or configured.
- Balance.
- Transaction reference.
- Transaction date/time when present.
- `رقم العملية` and `رقم المعاملة`.
- `جنيه` and `جنية` variants.
- Arabic and Latin digits.
- Arabic and English punctuation.
- Wallet formats such as `01...`, `+201...`, and `00201...`.
- Marketing text appended after a valid transaction message.

The parser must **never invent missing sender information**. If a provider sends a sender name without a wallet number, the sender wallet remains unknown and the transaction can continue through the existing manual-review/matching flow.

### Current real-world wallet formats

The current test coverage includes Vodafone Cash and Orange Cash message families, including messages where Orange uses wording similar to Vodafone (`تم استلام مبلغ ...`). Provider classification therefore cannot rely on that phrase alone.

For detailed parser behavior and regression cases, see:

- [`docs/WALLET_SMS_PARSING.md`](docs/WALLET_SMS_PARSING.md)

---

# Provisioning

Provisioning is handled asynchronously by the worker.

A service allocation requires an active `server_endpoint` connected to the relevant category through `category_endpoints` and a valid `provider_inbound_tag` that maps to the real provider inbound.

The worker can:

1. Select an eligible endpoint.
2. Check capacity.
3. Apply the plan duration/configuration.
4. Create or update the provider-side user/subscription.
5. Produce the customer-facing configuration when permitted.
6. Persist the resulting state in PostgreSQL.

Marzban is treated as an external provider. It is **not required to run on the same application server**.

Provider credentials are stored encrypted in `provider_instances` rather than being placed directly in `.env`.

---

# Authentication & Security

The platform includes the following security controls in the current architecture:

- Customer and staff authentication.
- Argon2id password hashing.
- Session-based authentication.
- CSRF protection.
- TOTP for staff authentication.
- RBAC for staff roles.
- Idempotency keys for order operations.
- Encrypted provider credentials.
- Audit logging.
- Server-side payment parsing and matching.
- No production secrets committed to Git.

### Security rules

> Never put production passwords, API credentials, TOTP secrets, encryption keys, or provider credentials in Git.

> Never run application package installation/build commands as root.

> Do not bypass the payment parser/matcher by trusting a screenshot or client-side payment claim as proof of payment.

---

# Repository Structure

The repository is organized as a native application workspace:

```text
cowboybepob/
├── apps/
│   ├── api/                 # Fastify + TypeScript backend
│   └── web/                 # React + TypeScript frontend
│
├── db/
│   ├── schema.sql           # Database schema
│   └── migrations/          # Incremental database migrations
│
├── deploy/
│   ├── nginx/               # Nginx configuration
│   ├── systemd/             # API/worker services
│   └── audit-native.sh      # Native deployment audit
│
├── docs/
│   └── WALLET_SMS_PARSING.md
│
├── .env.example
├── package.json
└── README.md
```

Important backend areas include:

```text
apps/api/src/
├── payments/                # Payment ingestion, parsing, matching
├── routes/                  # HTTP/API routes
├── services/                # Business services
├── providers/               # External provider integrations
└── ...
```

---

# Runtime Ports

| Port | Service |
|---:|---|
| `5001` | Nginx / public web + Admin/Customer UI |
| `5002` | Fastify API on `127.0.0.1` |
| `5003` | Vite development server |
| `5432` | PostgreSQL |
| `8000` | Marzban on the separate provider server, depending on deployment |

Marzban is external to the application host. The API/worker communicates with it through configured provider instances.

---

# Requirements

- Ubuntu or Debian.
- Node.js 22+.
- PostgreSQL.
- Nginx.
- A Linux user with ownership of the application directory.
- A reachable Marzban instance when provider provisioning is enabled.

The production design does **not** require Docker.

---

# Environment

Create the environment file from the example:

```bash
cd ~/projects/cowboybepob
cp .env.example .env
nano .env
```

Typical production configuration:

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

Do not put Marzban credentials in `.env` when the provider-instance flow is enabled. Provider credentials belong in the encrypted provider configuration stored by the application.

---

# Database

Create the PostgreSQL user/database according to the deployment environment:

```bash
sudo -u postgres psql
```

```sql
CREATE USER cowboybepob WITH PASSWORD 'CHANGE_THIS_PASSWORD';
CREATE DATABASE cowboybepob OWNER cowboybepob;
\q
```

Apply the schema:

```bash
cd ~/projects/cowboybepob
PGPASSWORD='CHANGE_THIS_PASSWORD' psql \
  -h 127.0.0.1 \
  -U cowboybepob \
  -d cowboybepob \
  -f db/schema.sql
```

Apply the required migrations available in the repository:

```bash
PGPASSWORD='CHANGE_THIS_PASSWORD' psql \
  -h 127.0.0.1 \
  -U cowboybepob \
  -d cowboybepob \
  -f db/migrations/001_provider_credentials.sql
```

Use the repository's migration files as the authoritative source for the current schema state.

---

# Add a Marzban Provider

After configuring the environment and database:

```bash
cd ~/projects/cowboybepob
npm run provider:add -- \
  --name="Default Marzban" \
  --url="http://MARZBAN_SERVER:8000" \
  --username="MARZBAN_USERNAME" \
  --password="MARZBAN_PASSWORD"
```

The credentials are stored through the provider configuration flow and should not be committed to the repository.

---

# Local Development

Install dependencies:

```bash
cd ~/projects/cowboybepob
npm install
```

Run the API:

```bash
npm run dev -w @cowboybepob/api
```

Run the web application:

```bash
npm run dev -w @cowboybepob/web
```

Run the complete validation set before pushing changes:

```bash
npm test
npm run typecheck
npm run build
```

---

# Production Deployment

## 1. Pull the application

```bash
cd ~/projects/cowboybepob
git pull --ff-only
```

## 2. Install and validate

```bash
npm install
npm test
npm run typecheck
npm run build
```

## 3. Install systemd services

```bash
sudo cp deploy/systemd/cowboybepob-api.service /etc/systemd/system/
sudo cp deploy/systemd/cowboybepob-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cowboybepob-api cowboybepob-worker
```

## 4. Configure Nginx

```bash
sudo cp deploy/nginx/cowboybepob.conf /etc/nginx/conf.d/cowboybepob.conf
sudo nginx -t
sudo systemctl reload nginx
```

The CowboyBepob Nginx configuration should coexist with other sites on the host. Do not delete unrelated Nginx configurations.

## 5. Restart after an application update

```bash
sudo systemctl restart cowboybepob-api
sudo systemctl restart cowboybepob-worker
```

## 6. Verify

```bash
curl -i http://127.0.0.1:5002/health
curl -i http://127.0.0.1:5001/health
curl -I http://127.0.0.1:5001/

sudo systemctl --no-pager status cowboybepob-api
sudo systemctl --no-pager status cowboybepob-worker
sudo nginx -t
```

---

# Operations

## Logs

API:

```bash
sudo journalctl -u cowboybepob-api -n 200 --no-pager
```

Worker:

```bash
sudo journalctl -u cowboybepob-worker -n 200 --no-pager
```

Follow API logs live:

```bash
sudo journalctl -u cowboybepob-api -f
```

Follow worker logs live:

```bash
sudo journalctl -u cowboybepob-worker -f
```

Nginx:

```bash
sudo journalctl -u nginx -n 100 --no-pager
```

## Native deployment audit

```bash
cd ~/projects/cowboybepob
deploy/audit-native.sh
```

The audit checks the native runtime, ownership, Node.js, PostgreSQL, Nginx, systemd services, health endpoints, ports, typecheck, and build state.

---

# Troubleshooting

## API is running but the UI cannot reach it

Check:

```bash
curl -i http://127.0.0.1:5002/health
sudo systemctl status cowboybepob-api --no-pager
sudo nginx -t
```

Then inspect:

```bash
sudo journalctl -u cowboybepob-api -n 200 --no-pager
```

## Worker is not provisioning services

Check:

```bash
sudo systemctl status cowboybepob-worker --no-pager
sudo journalctl -u cowboybepob-worker -n 200 --no-pager
```

Verify that an active `server_endpoint` exists, that the endpoint is associated with the correct category, and that the provider inbound tag matches the actual provider configuration.

## Wallet SMS shows `SENDER_NOT_FOUND`

Do not immediately change the database or payment flow.

First inspect the actual raw message stored in `payment_sms` and compare it with the parser's regression tests.

Useful logs:

```bash
sudo journalctl -u cowboybepob-api --since "20 minutes ago" --no-pager | \
  grep -E "SMS_RECEIVED|SMS_PARSE_FAILED|SMS_PARSED|SMS_MATCH"
```

The parser must be tested against the **raw SMS received by the API**, not only the text displayed by the UI.

For current wallet parsing rules:

- [`docs/WALLET_SMS_PARSING.md`](docs/WALLET_SMS_PARSING.md)

## Build passes locally but production behaves differently

Verify the production `dist` output and restart both systemd services after a successful build:

```bash
npm run build
sudo systemctl restart cowboybepob-api
sudo systemctl restart cowboybepob-worker
```

Then inspect the service logs immediately after reproducing the issue.

---

# Current Scope

The current MVP includes:

- React + TypeScript web application.
- Fastify + TypeScript API.
- PostgreSQL-backed commercial state.
- Dedicated background worker using PostgreSQL job locking patterns.
- Arabic/RTL Admin and Customer interfaces.
- Customer/staff authentication.
- Argon2id, sessions, CSRF, TOTP and RBAC.
- Categories, plans and router products.
- Customers, services, configs, subscriptions and allocations.
- Idempotent order handling.
- Manual payment and webhook foundation.
- Wallet SMS ingestion and parsing.
- Payment matching and manual-review flow.
- Marzban provisioning adapter.
- Encrypted provider credentials.
- Router inventory/lifecycle.
- Server hosts/endpoints.
- Audit logging.
- Native Nginx + systemd deployment.

---

# Not Yet Part of the MVP

The following items are outside the current MVP scope or are not fully implemented:

- Full Tailscale API/OAuth integration and real device binding.
- RouterGateway / `cb-remote` with complete OpenWrt configuration application.
- Full commercial payment-gateway integration.
- Prometheus/Grafana monitoring stack.
- Firmware fleet management.
- Complete automatic migration/load-aware balancing.
- Full refund and reconciliation workflows.

These should be implemented without bypassing the existing domain boundaries.

---

# Roadmap

```text
Foundation
   │
   ├── Customer + Staff Authentication
   ├── Catalog + Orders
   ├── Services + Configs
   └── PostgreSQL commercial state
          │
          ▼
Provisioning
   │
   ├── Provider Instances
   ├── Server Endpoints
   ├── Marzban Adapter
   └── Worker-based allocation
          │
          ▼
Payments
   │
   ├── Wallet SMS ingestion
   ├── Normalization + parsing
   ├── Matching
   └── Manual review / audit
          │
          ▼
Infrastructure
   │
   ├── Router inventory
   ├── RouterGateway
   ├── Tailscale integration
   └── OpenWrt automation
          │
          ▼
Operations
   │
   ├── Observability
   ├── Reconciliation
   ├── Migration / balancing
   └── Fleet management
```

---

# Documentation

Project documentation is kept in the repository so deployment and operational decisions remain reproducible.

| Document | Purpose |
|---|---|
| [`README.md`](README.md) | Project overview, architecture, setup, deployment and operations |
| [`docs/WALLET_SMS_PARSING.md`](docs/WALLET_SMS_PARSING.md) | Wallet SMS parsing architecture and regression cases |
| `db/schema.sql` | Database schema |
| `db/migrations/` | Database migrations |
| `deploy/systemd/` | Native systemd service definitions |
| `deploy/nginx/` | Nginx deployment configuration |
| `deploy/audit-native.sh` | Native deployment audit |

---

# Development Rules

### Do

- Keep business state in PostgreSQL.
- Keep external provider integrations behind provider boundaries.
- Add regression tests for every new SMS format.
- Validate with `npm test`, `npm run typecheck`, and `npm run build` before deployment.
- Keep production credentials out of Git.
- Use migrations for database changes.
- Preserve idempotency in payment/order flows.
- Keep manual-review paths available when automatic matching is unsafe.

### Do not

- Do not run `npm install` or `npm run build` with `sudo`.
- Do not wipe or reset production payment records to fix a parser issue.
- Do not bypass the matcher to mark payments as successful.
- Do not hardcode provider credentials or wallet numbers.
- Do not delete unrelated Nginx configurations.
- Do not make provider-specific assumptions that reject valid wallet messages unnecessarily.

---

# License / Project Status

CowboyBepob is currently maintained as a private project/application. The repository README documents the current implementation and deployment contract; the codebase remains the authoritative source for exact behavior.

---

**CowboyBepob — one platform for customers, services, provisioning, payments, routers, and operations.**
