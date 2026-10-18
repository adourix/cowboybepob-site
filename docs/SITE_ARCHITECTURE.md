# Proxy + Router Sales Platform --- Architecture

Status: design only. No implementation code until this is accepted.

Scope: one platform that sells (A) proxy configurations/subscriptions and
(B) physical OpenWrt routers, with an admin panel, a customer panel,
provisioning, server allocation, Marzban integration and Tailscale-based
router management.

Reading guide: sections 1-3 are the decisions, 4-5 are the data model,
6-8 are structure and APIs, 9-12 are the workflows, 13-16 are
integrations and security, 17-19 are scale, scope and open questions.

------------------------------------------------------------------------

# 1. Review of the proposed model: flaws and corrections

| # | Proposed | Problem | Correction |
|---|---|---|---|
| 1 | One `Server` = IP + port | CPU/RAM, health, provider credentials and the Marzban node belong to the machine, not to a port. Two ports on one IP share the same load. | Split into `hosts` (machine) and `server_endpoints` (one IP+port entry). Endpoints stay independently selectable and are never merged. |
| 2 | Allocation flow creates Service and Subscription after provisioning | If the proxy call fails, nothing exists to retry, show or refund against. The external username also needs a stable id first. | Create Service, Subscription (PENDING) and the allocation reservation first, in one DB transaction. Call the proxy provider after commit. Activate in a second transaction. |
| 3 | Service status includes EXPIRED | Expiry is a subscription fact. Two sources of truth drift. | Service status is operational (PROVISIONING, ACTIVE, SUSPENDED, FAILED, TERMINATED). Subscription status carries EXPIRED. The customer-facing status is computed from both. |
| 4 | Order status carries payment and provisioning failure | A paid order cannot be "FAILED". One order mixes items that finish at different times (router vs config). | Order = commercial state only. Fulfillment lives per order item. A paid order with a failing item stays open and visible to admins. |
| 5 | Router states mix lifecycle and connectivity | ONLINE/OFFLINE change every minute and are observations, not lifecycle. | Lifecycle: IN_STOCK, ASSIGNED, PROVISIONING, READY, REPLACED, DECOMMISSIONED. Connectivity is a separate derived field. STOLEN is a decommission reason. |
| 6 | A router may hold several services | The router software runs one proxy profile today. Multiple profiles are future work in the router project. | MVP: at most one live service per router (partial unique index). The schema stays N-capable: dropping the index later is enough. |
| 7 | Config contains the server endpoint | Migration would force a new config identity. | Config holds the client credential and protocol parameters only. The client link is rendered from Config + current allocation. Migration changes the allocation, not the credential. |
| 8 | `POST /customer/routers/{id}/replacement` | A customer must not trigger hardware swaps or credential changes directly. | It creates a replacement request. Staff approve and execute it. |
| 9 | Category holds price and duration | A category normally sells several durations (30/90 days). | Add `config_plans` under a category. Order items snapshot the price. |
| 10 | Subscription start on payment | For router bundles the customer loses days to shipping. | Start when the service first becomes ACTIVE. For router bundles that happens on shipment (staff action). A provisional expiry on the proxy account is a failsafe. |
| 11 | Replacement keeps the same credential | A lost or stolen router keeps working with the old credential. | Replacement has a `rotate_credentials` option (default on): new config version, same service and subscription. |
| 12 | Marzban holds usage and runtime state | Source of truth is the app DB, but state can drift. | Deterministic external usernames, idempotent calls, and a periodic reconcile job that reports orphans, missing users and drift. |
| 13 | Tailscale as a flat management network | All routers on one tailnet can see each other. | Tags and ACLs: only the backend (and admins) reach routers. Router-to-router is denied. Customers are never on the tailnet. |
| 14 | Admin panel on the public internet | High-value target. | Separate admin listener reachable only over the tailnet or an allowlist, with mandatory 2FA. |
| 15 | Payments assumed online-gateway only | Webhooks repeat and arrive out of order. Manual payments (cash/transfer) may exist. | `payment_events` table with unique event ids, server-side amount/currency checks, and a manual payment path recorded by finance staff. |
| 16 | A customer screenshot (or "I paid") as proof of payment | Easy to forge and reuse. A gateway fee of 2.75% + 3 EGP is also too heavy for 15-30 EGP plans. | No gateway for now. The SMS received by our Vodafone Cash wallet phone is the evidence. AUTO_VERIFIED is not PAID. An accountant confirms. Delivery waits for PAID (section 8.14). |

------------------------------------------------------------------------

# 2. Domain model

Identities that must never be merged:

``` text
Customer       who pays and owns things
Router         a physical OpenWrt device
Service        the customer's ongoing proxy service
Config         the technical credential + protocol parameters (versioned)
Subscription   the paid entitlement (time + quota)
ConfigCategory the commercial product type (We, Etisalat, ...)
ConfigPlan     a sellable variant of a category (duration, quota, price)
Host           an infrastructure machine
ServerEndpoint one selectable IP+port entry on a host ("a server")
Order          what was purchased
Payment        money movement for an order
```

Relationships:

``` text
Customer
 |-- Routers (0..n)            Router --- TailscaleDevice (0..1)
 |-- Services (0..n)
 |     |-- Config (versions)
 |     |-- Subscription (1) --- SubscriptionPeriods (n)
 |     |-- ServiceAllocations (history; 1 active)
 |     |-- ProxyAccount(s) at a provider instance
 |     `-- Router (optional, nullable)
 `-- Orders (0..n) --- OrderItems --- Payments

ConfigCategory --- Plans
ConfigCategory <--many-to-many--> ServerEndpoint (via category_endpoints)
Host --- ServerEndpoints
ProviderInstance (a Marzban panel) --- Hosts, ProxyAccounts
```

Core rules (invariants):

1.  A Service belongs to exactly one Customer and one Category.
2.  A Service has at most one ACTIVE allocation at any time.
3.  A Service has exactly one Subscription row; its time is the sum of
    periods.
4.  Renewal extends the Subscription. It never creates an allocation,
    never changes the endpoint and never creates a new config version.
5.  Migration is a separate, recorded operation on the allocation.
6.  `services.router_id` is nullable. A standalone service is the same
    entity with no router.
7.  Router replacement moves the service to another router. The
    subscription and the allocation are untouched.
8.  Every IP+port is its own endpoint. Hosts are grouped only by an
    explicit admin choice.
9.  Customers can only read rows where `customer_id` equals the
    authenticated customer, enforced in the backend.
10. The app DB is the business source of truth. Marzban owns runtime
    proxy users and traffic counters.

------------------------------------------------------------------------

# 3. Entity relationship diagram

``` mermaid
erDiagram
  CUSTOMERS ||--o{ ROUTERS : owns
  CUSTOMERS ||--o{ SERVICES : has
  CUSTOMERS ||--o{ ORDERS : places
  ROUTERS ||--o| TAILSCALE_DEVICES : "managed via"
  ROUTERS |o--o{ SERVICES : "serves (optional)"
  ROUTERS ||--o{ ROUTER_REPLACEMENTS : "old or new"
  CONFIG_CATEGORIES ||--o{ CONFIG_PLANS : offers
  CONFIG_CATEGORIES ||--o{ SERVICES : "type of"
  CONFIG_CATEGORIES ||--o{ CATEGORY_ENDPOINTS : includes
  SERVER_ENDPOINTS ||--o{ CATEGORY_ENDPOINTS : "eligible for"
  PROVIDER_INSTANCES ||--o{ HOSTS : manages
  HOSTS ||--o{ SERVER_ENDPOINTS : exposes
  SERVICES ||--o{ CONFIGS : versions
  SERVICES ||--|| SUBSCRIPTIONS : entitles
  SUBSCRIPTIONS ||--o{ SUBSCRIPTION_PERIODS : periods
  SERVICES ||--o{ SERVICE_ALLOCATIONS : history
  SERVER_ENDPOINTS ||--o{ SERVICE_ALLOCATIONS : hosts
  SERVICES ||--o{ PROXY_ACCOUNTS : "provider identity"
  PROVIDER_INSTANCES ||--o{ PROXY_ACCOUNTS : holds
  PROXY_ACCOUNTS ||--o{ SERVICE_ALLOCATIONS : "used by"
  ORDERS ||--|{ ORDER_ITEMS : contains
  ORDERS ||--o{ PAYMENTS : "paid by"
  PAYMENTS ||--o{ REFUNDS : "refunded by"
  PAYMENT_METHODS ||--o{ PAYMENTS : "paid with"
  PAYMENT_DEVICES ||--o{ PAYMENT_SMS : delivers
  PAYMENT_SMS |o--o| PAYMENTS : "matched to"
  PAYMENTS ||--o{ PAYMENT_AUDIT_LOG : "audited by"
  ORDER_ITEMS }o--o| CONFIG_PLANS : plan
  ORDER_ITEMS }o--o| ROUTER_PRODUCTS : sku
  ORDER_ITEMS |o--o| SERVICES : "creates or renews"
  SUBSCRIPTION_PERIODS |o--o| ORDER_ITEMS : "granted by"
```

Table count: 33 (section 4). Tables from the original list that were
merged or renamed:

-   `proxy_providers` -> `provider_instances` (one row per Marzban panel).
-   `proxy_accounts / provider_connections` -> `proxy_accounts` (the
    service's identity on a provider instance).
-   `products/plans` -> `config_plans` and `router_products`.
-   `servers` -> `hosts` + `server_endpoints`.
-   `category_servers` -> `category_endpoints`.
-   `service_allocations` is kept as the single history entity (no
    separate `ServiceServerHistory`, no separate migrations table).
-   Added for payment verification: `payment_methods`, `payment_devices`,
    `payment_sms`, `payment_audit_log`, and a small `settings` table.

------------------------------------------------------------------------

# 4. Database (PostgreSQL 15+)

Conventions:

-   Primary keys are `uuid`. Every business entity also has a readable
    `public_code` (for example `CUS-000123`, `RTR-000102`) from a
    sequence. Codes are for humans and support. Authorization never
    relies on them.
-   Money is `bigint` in minor units (piastres) plus `currency` (`EGP`).
-   Time is `timestamptz`, stored in UTC.
-   Enumerations are `text` with `CHECK` constraints (easier to migrate
    than native enums).
-   Secrets (client UUIDs, provider credentials) are encrypted at the
    application level. The DB never stores raw provider passwords.
-   Soft delete (`deleted_at`) only on customers. Everything else keeps
    history through status columns.

## 4.1 Extensions and code sequences

``` sql
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SEQUENCE customer_code_seq;
CREATE SEQUENCE router_code_seq;
CREATE SEQUENCE endpoint_code_seq;
CREATE SEQUENCE service_code_seq;
CREATE SEQUENCE config_code_seq;
CREATE SEQUENCE subscription_code_seq;
CREATE SEQUENCE order_code_seq START 1001;
```

## 4.2 Identity and access

``` sql
CREATE TABLE customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code     text NOT NULL UNIQUE
                  DEFAULT ('CUS-' || lpad(nextval('customer_code_seq')::text, 6, '0')),
  full_name       text NOT NULL,
  email           citext NOT NULL UNIQUE,
  email_verified_at timestamptz,
  mobile_phone    text NOT NULL CHECK (mobile_phone ~ '^\+?[0-9]{8,15}$'),  -- exactly one mobile
  address_line    text NOT NULL,
  city            text NOT NULL,
  governorate     text,
  country         char(2) NOT NULL DEFAULT 'EG',
  password_hash   text,                           -- argon2id; NULL until an invitation is accepted
  status          text NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('INVITED','ACTIVE','BLOCKED','DELETED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CHECK (status IN ('INVITED','DELETED') OR password_hash IS NOT NULL)
);
CREATE INDEX customers_mobile_idx ON customers (mobile_phone);

CREATE TABLE customer_landlines (          -- any number of landlines per customer
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  number          text NOT NULL
                  CHECK (number ~ '^0[0-9]{8,10}$'),   -- local format, area code included, no +20, no spaces
  label           text,                    -- "home", "work", ...
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, number)
);
CREATE INDEX customer_landlines_number_idx ON customer_landlines (number);

CREATE TABLE staff_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL UNIQUE,
  full_name       text NOT NULL,
  password_hash   text NOT NULL,
  role            text NOT NULL
                  CHECK (role IN ('SUPER_ADMIN','ADMIN','SUPPORT','TECHNICIAN','FINANCE')),
  totp_secret_enc bytea,
  totp_enabled    boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','DISABLED')),
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_type  text NOT NULL CHECK (principal_type IN ('CUSTOMER','STAFF')),
  principal_id    uuid NOT NULL,
  token_hash      bytea NOT NULL UNIQUE,
  ip              inet,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz
);
CREATE INDEX auth_sessions_principal_idx ON auth_sessions (principal_type, principal_id);

CREATE TABLE auth_tokens (                 -- email verification, password reset, invitations
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_type  text NOT NULL CHECK (principal_type IN ('CUSTOMER','STAFF')),
  principal_id    uuid NOT NULL,
  purpose         text NOT NULL CHECK (purpose IN ('EMAIL_VERIFY','PASSWORD_RESET','INVITE')),
  token_hash      bytea NOT NULL UNIQUE,   -- only the hash is stored
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_principal_idx ON auth_tokens (principal_type, principal_id, purpose);
```

Phone rules:

-   **Mobile:** exactly one per customer (`customers.mobile_phone`,
    required). Stored in international format (`+201...`) because SMS and
    WhatsApp gateways need it. The UI shows it in the local format.
-   **Landline:** any number per customer (`customer_landlines`). Stored
    exactly as dialed inside Egypt: digits only, area code included,
    starting with `0`, without `+20` and without spaces or dashes
    (for example `0225551111`). The database rejects other formats.
-   Input cleanup happens in the application before saving (strip spaces,
    dashes and `+20`, add the leading `0`).

## 4.3 Infrastructure: providers, hosts, endpoints

``` sql
CREATE TABLE provider_instances (          -- one row per Marzban panel
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL CHECK (type IN ('MARZBAN')),
  name            text NOT NULL UNIQUE,
  base_url        text NOT NULL,
  credentials_ref text NOT NULL,           -- key in the secret store, not the secret
  api_version     text,
  status          text NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','DISABLED')),
  last_ok_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hosts (                       -- a machine
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  address         text NOT NULL,           -- IP or hostname
  country         char(2) NOT NULL,
  city            text,
  region          text,
  hosting_provider text,
  provider_instance_id uuid NOT NULL REFERENCES provider_instances(id),
  provider_node_ref text,                  -- Marzban node id, if a node
  status          text NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','MAINTENANCE','DISABLED','DECOMMISSIONED')),
  health_status   text NOT NULL DEFAULT 'UNKNOWN'
                  CHECK (health_status IN ('HEALTHY','DEGRADED','DOWN','UNKNOWN')),
  cpu_pct         numeric(5,2),
  ram_pct         numeric(5,2),
  metrics_at      timestamptz,
  last_health_check_at timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- Same address cannot be two live hosts. The admin UI offers to reuse the
-- existing host; it never merges silently.
CREATE UNIQUE INDEX hosts_live_address_uq ON hosts (address)
  WHERE status <> 'DECOMMISSIONED';

CREATE TABLE server_endpoints (            -- what the business calls "a server"
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code     text NOT NULL UNIQUE
                  DEFAULT ('SRV-' || lpad(nextval('endpoint_code_seq')::text, 6, '0')),
  host_id         uuid NOT NULL REFERENCES hosts(id),
  name            text NOT NULL,           -- "Germany #1"
  port            integer NOT NULL CHECK (port BETWEEN 1 AND 65535),
  protocol        text NOT NULL,           -- vless | vmess | ...
  transport       text,
  security        text,
  provider_inbound_tag text NOT NULL,      -- Marzban inbound this port maps to
  public_params   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- non-secret client params (sni, pbk, sid, path)
  status          text NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','DRAINING','MAINTENANCE','DISABLED')),
  health_status   text NOT NULL DEFAULT 'UNKNOWN'
                  CHECK (health_status IN ('HEALTHY','DEGRADED','DOWN','UNKNOWN')),
  last_health_check_at timestamptz,
  max_services    integer NOT NULL CHECK (max_services >= 0),
  allocated_count integer NOT NULL DEFAULT 0 CHECK (allocated_count >= 0),
  weight          integer NOT NULL DEFAULT 100 CHECK (weight > 0),
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (host_id, port)
);
CREATE INDEX server_endpoints_alloc_idx ON server_endpoints (status, health_status)
  WHERE status = 'ACTIVE';
```

## 4.4 Catalog

``` sql
CREATE TABLE config_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  description     text,
  protocol        text NOT NULL,           -- required endpoint protocol
  router_compatible boolean NOT NULL DEFAULT true,
  link_visibility text NOT NULL DEFAULT 'STANDALONE_ONLY'
                  CHECK (link_visibility IN ('ALWAYS','STANDALONE_ONLY','NEVER')),
  status          text NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT','ACTIVE','INACTIVE')),
  display_order   integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE category_endpoints (          -- many-to-many
  category_id     uuid NOT NULL REFERENCES config_categories(id),
  endpoint_id     uuid NOT NULL REFERENCES server_endpoints(id),
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  priority        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (category_id, endpoint_id)
);
CREATE INDEX category_endpoints_endpoint_idx ON category_endpoints (endpoint_id);

CREATE TABLE config_plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     uuid NOT NULL REFERENCES config_categories(id),
  name            text NOT NULL,
  duration_days   integer NOT NULL CHECK (duration_days > 0),
  price_minor     bigint NOT NULL CHECK (price_minor >= 0),
  currency        char(3) NOT NULL DEFAULT 'EGP',
  quota_bytes     bigint CHECK (quota_bytes IS NULL OR quota_bytes > 0),  -- NULL = unlimited
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, name)
);

CREATE TABLE router_products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku             text NOT NULL UNIQUE,
  name            text NOT NULL,
  model           text NOT NULL,
  price_minor     bigint NOT NULL CHECK (price_minor >= 0),
  currency        char(3) NOT NULL DEFAULT 'EGP',
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

## 4.5 Routers and Tailscale

``` sql
CREATE TABLE routers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code     text NOT NULL UNIQUE
                  DEFAULT ('RTR-' || lpad(nextval('router_code_seq')::text, 6, '0')),
  customer_id     uuid REFERENCES customers(id),          -- NULL while in stock
  product_id      uuid REFERENCES router_products(id),
  serial_number   text NOT NULL UNIQUE,
  device_identifier text UNIQUE,                          -- board MAC / board id
  model           text NOT NULL,
  hardware_revision text,
  openwrt_version text,
  firmware_version text,
  manager_version text,
  sing_box_version text,
  lifecycle_status text NOT NULL DEFAULT 'IN_STOCK'
                  CHECK (lifecycle_status IN
                    ('IN_STOCK','ASSIGNED','PROVISIONING','READY','REPLACED','DECOMMISSIONED')),
  decommission_reason text
                  CHECK (decommission_reason IN ('REPLACED','BROKEN','STOLEN','RETURNED','OTHER')),
  replaced_by_router_id uuid REFERENCES routers(id),
  connectivity    text NOT NULL DEFAULT 'UNKNOWN'
                  CHECK (connectivity IN ('ONLINE','OFFLINE','UNKNOWN')),   -- observed, cached
  last_seen_at    timestamptz,
  desired_config_version integer NOT NULL DEFAULT 0,       -- future sync
  applied_config_version integer NOT NULL DEFAULT 0,
  last_apply_status text,
  last_apply_at   timestamptz,
  last_error      text,
  shipped_at      timestamptz,
  first_online_at timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (lifecycle_status NOT IN ('ASSIGNED','PROVISIONING','READY') OR customer_id IS NOT NULL)
);
CREATE INDEX routers_customer_idx ON routers (customer_id);
CREATE INDEX routers_status_idx ON routers (lifecycle_status, connectivity);

CREATE TABLE tailscale_devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tailscale_node_id text NOT NULL UNIQUE,
  hostname        text NOT NULL,
  tailscale_ips   text[] NOT NULL DEFAULT '{}',
  os              text,
  tags            text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'NEW'
                  CHECK (status IN ('NEW','LINKED','IGNORED','REMOVED')),
  router_id       uuid UNIQUE REFERENCES routers(id),      -- 1:1 when linked
  online          boolean NOT NULL DEFAULT false,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz,
  key_expiry_at   timestamptz,
  raw             jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'LINKED') = (router_id IS NOT NULL))
);

CREATE TABLE router_replacements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES customers(id),
  old_router_id   uuid NOT NULL REFERENCES routers(id),
  new_router_id   uuid REFERENCES routers(id),
  status          text NOT NULL DEFAULT 'REQUESTED'
                  CHECK (status IN ('REQUESTED','APPROVED','PROVISIONING','COMPLETED','REJECTED','CANCELLED')),
  reason          text,
  rotate_credentials boolean NOT NULL DEFAULT true,
  requested_by_type text NOT NULL CHECK (requested_by_type IN ('CUSTOMER','STAFF')),
  requested_by_id uuid NOT NULL,
  billing_order_id uuid,                                   -- paid replacement, if any
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);
-- one open replacement per old router
CREATE UNIQUE INDEX router_replacements_open_uq ON router_replacements (old_router_id)
  WHERE status IN ('REQUESTED','APPROVED','PROVISIONING');
```

## 4.6 Services, configs, allocations, subscriptions

``` sql
CREATE TABLE services (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code     text NOT NULL UNIQUE
                  DEFAULT ('SV-' || lpad(nextval('service_code_seq')::text, 6, '0')),
  customer_id     uuid NOT NULL REFERENCES customers(id),
  category_id     uuid NOT NULL REFERENCES config_categories(id),
  plan_id         uuid NOT NULL REFERENCES config_plans(id),   -- current plan
  router_id       uuid REFERENCES routers(id),                 -- NULL = standalone
  label           text,                                        -- customer nickname
  status          text NOT NULL DEFAULT 'PROVISIONING'
                  CHECK (status IN ('PROVISIONING','ACTIVE','SUSPENDED','FAILED','TERMINATED')),
  suspend_reason  text,
  origin_order_item_id uuid UNIQUE,                            -- idempotency anchor
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  terminated_at   timestamptz
);
CREATE INDEX services_customer_idx ON services (customer_id);
CREATE INDEX services_category_idx ON services (category_id);
-- MVP rule: one live service per router. Drop this index to allow several.
CREATE UNIQUE INDEX services_one_live_per_router_uq ON services (router_id)
  WHERE router_id IS NOT NULL AND status IN ('PROVISIONING','ACTIVE','SUSPENDED');

CREATE TABLE configs (                      -- credential + protocol parameters, versioned
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code     text NOT NULL UNIQUE
                  DEFAULT ('CFG-' || lpad(nextval('config_code_seq')::text, 6, '0')),
  service_id      uuid NOT NULL REFERENCES services(id),
  version         integer NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','CURRENT','SUPERSEDED','REVOKED')),
  protocol        text NOT NULL,
  transport       text,
  security        text,
  client_credential_enc bytea NOT NULL,     -- encrypted client UUID
  credential_key_id text NOT NULL,          -- encryption key id (rotation)
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- non-secret, server-independent
  created_at      timestamptz NOT NULL DEFAULT now(),
  superseded_at   timestamptz,
  UNIQUE (service_id, version)
);
CREATE UNIQUE INDEX configs_one_current_uq ON configs (service_id) WHERE status = 'CURRENT';

CREATE TABLE proxy_accounts (               -- the service's identity on a provider instance
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      uuid NOT NULL REFERENCES services(id),
  provider_instance_id uuid NOT NULL REFERENCES provider_instances(id),
  external_username text NOT NULL,          -- deterministic, e.g. cb-sv-000123
  external_ref    text,
  status          text NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','ACTIVE','DISABLED','DELETED','ERROR')),
  external_expire_at timestamptz,           -- what we last pushed
  last_synced_at  timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_instance_id, external_username)
);
CREATE UNIQUE INDEX proxy_accounts_service_instance_uq
  ON proxy_accounts (service_id, provider_instance_id) WHERE status <> 'DELETED';

CREATE TABLE service_allocations (          -- sticky assignment + full history
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      uuid NOT NULL REFERENCES services(id),
  endpoint_id     uuid NOT NULL REFERENCES server_endpoints(id),
  proxy_account_id uuid REFERENCES proxy_accounts(id),
  status          text NOT NULL DEFAULT 'RESERVED'
                  CHECK (status IN ('RESERVED','PROVISIONING','ACTIVE','RETIRING','RETIRED','FAILED')),
  reason          text NOT NULL CHECK (reason IN ('INITIAL','MIGRATION')),
  supersedes_id   uuid REFERENCES service_allocations(id),
  note            text,
  failed_reason   text,
  created_by_type text NOT NULL CHECK (created_by_type IN ('STAFF','SYSTEM')),
  created_by_id   uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  activated_at    timestamptz,
  retired_at      timestamptz
);
CREATE UNIQUE INDEX alloc_one_active_uq ON service_allocations (service_id)
  WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX alloc_one_pending_uq ON service_allocations (service_id)
  WHERE status IN ('RESERVED','PROVISIONING');
CREATE INDEX alloc_endpoint_idx ON service_allocations (endpoint_id, status);

CREATE TABLE subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code     text NOT NULL UNIQUE
                  DEFAULT ('SUB-' || lpad(nextval('subscription_code_seq')::text, 6, '0')),
  service_id      uuid NOT NULL UNIQUE REFERENCES services(id),
  plan_id         uuid NOT NULL REFERENCES config_plans(id),
  status          text NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','ACTIVE','EXPIRED','CANCELLED')),
  starts_at       timestamptz,
  current_period_end timestamptz,
  grace_until     timestamptz,
  quota_bytes     bigint,                    -- NULL = unlimited
  used_bytes      bigint NOT NULL DEFAULT 0, -- cached from the provider
  usage_synced_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_expiry_idx ON subscriptions (current_period_end)
  WHERE status = 'ACTIVE';

CREATE TABLE subscription_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  order_item_id   uuid,                      -- NULL for admin grants
  source          text NOT NULL CHECK (source IN ('ORDER','ADMIN_GRANT')),
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  quota_bytes     bigint,
  created_by_staff_id uuid REFERENCES staff_users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
-- a given purchased item can extend a subscription only once
CREATE UNIQUE INDEX subscription_periods_item_uq ON subscription_periods (order_item_id)
  WHERE order_item_id IS NOT NULL;
```

## 4.7 Commerce

``` sql
CREATE TABLE orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code     text NOT NULL UNIQUE
                  DEFAULT ('ORD-' || lpad(nextval('order_code_seq')::text, 6, '0')),
  customer_id     uuid NOT NULL REFERENCES customers(id),
  status          text NOT NULL DEFAULT 'PENDING_PAYMENT'
                  CHECK (status IN ('PENDING_PAYMENT','PAID','FULFILLING','COMPLETED','CANCELLED','REFUNDED')),
  currency        char(3) NOT NULL DEFAULT 'EGP',
  subtotal_minor  bigint NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor  bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  total_minor     bigint NOT NULL CHECK (total_minor >= 0),
  idempotency_key text,
  placed_at       timestamptz NOT NULL DEFAULT now(),
  paid_at         timestamptz,
  completed_at    timestamptz,
  cancelled_at    timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, idempotency_key)
);
CREATE INDEX orders_customer_idx ON orders (customer_id, placed_at DESC);

CREATE TABLE order_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id),
  item_type       text NOT NULL CHECK (item_type IN ('ROUTER','CONFIG_NEW','CONFIG_RENEWAL')),
  router_product_id uuid REFERENCES router_products(id),
  plan_id         uuid REFERENCES config_plans(id),
  target_service_id uuid REFERENCES services(id),           -- renewals
  attach_to_item_id uuid REFERENCES order_items(id),        -- config bought with a router
  use_with_router boolean NOT NULL DEFAULT false,
  name_snapshot   text NOT NULL,
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  fulfillment_status text NOT NULL DEFAULT 'PENDING'
                  CHECK (fulfillment_status IN
                    ('PENDING','IN_PROGRESS','NEEDS_ATTENTION','FULFILLED','CANCELLED')),
  fulfillment_detail text,
  result_service_id uuid REFERENCES services(id),
  result_router_id  uuid REFERENCES routers(id),
  fulfilled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (item_type = 'ROUTER'         AND router_product_id IS NOT NULL AND plan_id IS NULL AND target_service_id IS NULL) OR
    (item_type = 'CONFIG_NEW'     AND plan_id IS NOT NULL AND router_product_id IS NULL AND target_service_id IS NULL) OR
    (item_type = 'CONFIG_RENEWAL' AND plan_id IS NOT NULL AND target_service_id IS NOT NULL AND router_product_id IS NULL)
  )
);
CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_items_attention_idx ON order_items (fulfillment_status)
  WHERE fulfillment_status IN ('PENDING','IN_PROGRESS','NEEDS_ATTENTION');

CREATE TABLE payment_methods (               -- configuration, not code
  code            text PRIMARY KEY,          -- VODAFONE_CASH now; CARD etc. when a gateway is added
  display_name    text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('WALLET_SMS','GATEWAY','MANUAL')),
  gateway         text,                      -- adapter name for GATEWAY methods (future)
  min_amount_minor bigint NOT NULL DEFAULT 0 CHECK (min_amount_minor >= 0),
  max_amount_minor bigint,
  instructions    text,                      -- text shown to the customer
  enabled         boolean NOT NULL DEFAULT true,
  display_order   integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (max_amount_minor IS NULL OR max_amount_minor >= min_amount_minor),
  CHECK (kind <> 'GATEWAY' OR gateway IS NOT NULL)
);

CREATE TABLE payment_devices (               -- the Android phone(s) that receive the wallet SMS
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL UNIQUE,      -- e.g. android-wallet-01
  token_hash      bytea NOT NULL UNIQUE,     -- SHA-256 of the device token. The token itself is never stored.
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  app_version     text,
  last_ip         inet,
  last_heartbeat_at timestamptz,
  last_sms_at     timestamptz,
  created_by_staff_id uuid REFERENCES staff_users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  rotated_at      timestamptz,
  disabled_at     timestamptz
);

CREATE TABLE payment_sms (                   -- only money-received notifications are stored
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       uuid NOT NULL REFERENCES payment_devices(id),
  sender          text,                      -- originating address as reported by the phone
  raw_text        text NOT NULL,             -- staff-only; never written to application logs
  message_sha256  bytea NOT NULL,            -- hash of the normalized text (idempotency)
  received_at     timestamptz NOT NULL,      -- device clock
  server_received_at timestamptz NOT NULL DEFAULT now(),
  parse_status    text NOT NULL CHECK (parse_status IN ('PARSED','MALFORMED')),
  parse_errors    jsonb,
  amount_minor    bigint CHECK (amount_minor > 0),
  sender_wallet   text,
  sender_name     text,
  receiver_wallet text,
  balance_minor   bigint,
  transaction_time timestamptz,
  transaction_reference text,
  match_status    text NOT NULL DEFAULT 'UNMATCHED'
                  CHECK (match_status IN ('UNMATCHED','MATCHED','NEEDS_REVIEW','REJECTED')),
  reject_reason   text,                      -- WRONG_RECEIVER, MALFORMED
  flags           text[] NOT NULL DEFAULT '{}',   -- STALE, NO_REFERENCE, NO_CANDIDATE, ...
  candidate_payment_ids uuid[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, message_sha256),
  CHECK (parse_status = 'PARSED' OR match_status = 'REJECTED'),
  CHECK (match_status <> 'REJECTED' OR reject_reason IS NOT NULL)
);
-- the same Vodafone Cash transaction can exist once, even if two phones report it
CREATE UNIQUE INDEX payment_sms_reference_uq ON payment_sms (transaction_reference)
  WHERE transaction_reference IS NOT NULL;
CREATE INDEX payment_sms_unmatched_idx ON payment_sms (amount_minor, sender_wallet)
  WHERE match_status = 'UNMATCHED';
CREATE INDEX payment_sms_received_idx ON payment_sms (received_at);

CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id),
  customer_id     uuid NOT NULL REFERENCES customers(id),     -- ownership checks
  method_code     text NOT NULL REFERENCES payment_methods(code),
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),   -- expected amount, taken from the order on the server
  currency        char(3) NOT NULL DEFAULT 'EGP',
  customer_wallet text CHECK (customer_wallet ~ '^01[0125][0-9]{8}$'),   -- sender wallet given by the customer
  receiving_wallet text NOT NULL CHECK (receiving_wallet ~ '^01[0125][0-9]{8}$'),  -- snapshot of our wallet
  status          text NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','AUTO_VERIFIED','PENDING_REVIEW','PAID',
                                    'REJECTED','REVIEW_EXPIRED','EXPIRED')),
  status_reason   text,                                       -- machine reason: AMBIGUOUS_MATCH, ...
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,                       -- created_at + PAYMENT_WINDOW_MINUTES
  claimed_at      timestamptz,                                -- customer submitted wallet or screenshot
  screenshot_key  text,                                       -- private storage key
  screenshot_sha256 bytea,
  screenshot_mime text,
  screenshot_uploaded_at timestamptz,
  ocr             jsonb,                                      -- hints only, never decisive
  matched_sms_id  uuid UNIQUE REFERENCES payment_sms(id),     -- one SMS backs one payment
  transaction_reference text UNIQUE,                          -- one Vodafone Cash transaction, one payment
  received_amount_minor bigint,
  sender_wallet   text,
  receiver_wallet text,
  transaction_time timestamptz,
  match_details   jsonb,                                      -- which checks passed, candidates, confidence
  verified_at     timestamptz,
  review_deadline_at timestamptz,                             -- verified/review start + ACCOUNTANT_REVIEW_HOURS
  confirmed_by    text CHECK (confirmed_by IN ('STAFF','GATEWAY')),
  decided_by_staff_id uuid REFERENCES staff_users(id),
  decided_at      timestamptz,
  decision_reason text,
  order_notified_at timestamptz,                              -- the order system was told about PAID
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- only an accountant (or, later, a verified gateway) can make a payment PAID
  CHECK (status <> 'PAID' OR (confirmed_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (confirmed_by IS DISTINCT FROM 'STAFF' OR decided_by_staff_id IS NOT NULL),
  CHECK (status <> 'REJECTED' OR (decided_by_staff_id IS NOT NULL AND decision_reason IS NOT NULL)),
  -- AUTO_VERIFIED means every automatic check passed
  CHECK (status <> 'AUTO_VERIFIED' OR (
         matched_sms_id IS NOT NULL AND transaction_reference IS NOT NULL
         AND verified_at IS NOT NULL AND received_amount_minor = amount_minor
         AND sender_wallet = customer_wallet AND receiver_wallet = receiving_wallet))
);
-- an order has one live payment at a time
CREATE UNIQUE INDEX payments_one_live_per_order_uq ON payments (order_id)
  WHERE status IN ('PENDING','AUTO_VERIFIED','PENDING_REVIEW','REVIEW_EXPIRED','PAID');
CREATE INDEX payments_status_idx ON payments (status, created_at DESC);
CREATE INDEX payments_pending_match_idx ON payments (amount_minor, customer_wallet)
  WHERE status = 'PENDING';
CREATE INDEX payments_deadline_idx ON payments (review_deadline_at)
  WHERE status IN ('AUTO_VERIFIED','PENDING_REVIEW');
CREATE INDEX payments_customer_idx ON payments (customer_id, created_at DESC);

CREATE TABLE payment_events (               -- webhook de-duplication
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway         text NOT NULL,
  event_id        text NOT NULL,
  payment_id      uuid REFERENCES payments(id),
  payload         jsonb NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  result          text,
  UNIQUE (gateway, event_id)
);

CREATE TABLE refunds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      uuid NOT NULL REFERENCES payments(id),
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  reason          text,
  status          text NOT NULL DEFAULT 'REQUESTED'
                  CHECK (status IN ('REQUESTED','COMPLETED','FAILED')),
  gateway_refund_id text,
  created_by_staff_id uuid NOT NULL REFERENCES staff_users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_audit_log (             -- append-only, written by a trigger on every status change
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id      uuid NOT NULL REFERENCES payments(id),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  actor_type      text NOT NULL CHECK (actor_type IN ('SYSTEM','STAFF','CUSTOMER','DEVICE')),
  actor_id        text,
  action          text NOT NULL,             -- CREATED, STATUS_CHANGE
  from_status     text,
  to_status       text,
  reason          text,
  sms_id          uuid,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX payment_audit_payment_idx ON payment_audit_log (payment_id, occurred_at);

-- 1. Only the documented status transitions are possible, even for direct SQL.
CREATE FUNCTION payments_enforce_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'PENDING'        AND NEW.status IN ('AUTO_VERIFIED','PENDING_REVIEW','REJECTED','EXPIRED')) OR
      (OLD.status = 'AUTO_VERIFIED'  AND NEW.status IN ('PAID','REJECTED','REVIEW_EXPIRED')) OR
      (OLD.status = 'PENDING_REVIEW' AND NEW.status IN ('PAID','REJECTED','REVIEW_EXPIRED','PENDING')) OR
      (OLD.status = 'REVIEW_EXPIRED' AND NEW.status IN ('PAID','REJECTED'))
    ) THEN
      RAISE EXCEPTION 'invalid payment status transition % -> %', OLD.status, NEW.status;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER payments_transition BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_enforce_transition();

-- 2. No silent status change: the application must declare who acts
--    (SET LOCAL app.actor_type / app.actor_id / app.reason inside the transaction).
CREATE FUNCTION payments_write_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor text := NULLIF(current_setting('app.actor_type', true), '');
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'payment change without an actor (set app.actor_type)';
  END IF;
  INSERT INTO payment_audit_log (payment_id, actor_type, actor_id, action, from_status, to_status, reason, sms_id)
  VALUES (NEW.id, actor, NULLIF(current_setting('app.actor_id', true), ''),
          CASE WHEN TG_OP = 'INSERT' THEN 'CREATED' ELSE 'STATUS_CHANGE' END,
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
          NEW.status, NULLIF(current_setting('app.reason', true), ''), NEW.matched_sms_id);
  RETURN NEW;
END $$;
CREATE TRIGGER payments_audit_insert AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_write_audit();
CREATE TRIGGER payments_audit_status AFTER UPDATE OF status ON payments
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION payments_write_audit();

-- 3. The audit log cannot be edited or deleted.
CREATE FUNCTION payment_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment_audit_log is append-only';
END $$;
CREATE TRIGGER payment_audit_no_change BEFORE UPDATE OR DELETE ON payment_audit_log
  FOR EACH ROW EXECUTE FUNCTION payment_audit_append_only();
```

## 4.8 Jobs, settings and audit

``` sql
CREATE TABLE settings (                      -- runtime switches and limits (8.14.7)
  key             text PRIMARY KEY,
  value           jsonb NOT NULL,
  updated_by      uuid REFERENCES staff_users(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (                          -- DB-backed queue (no Redis in MVP)
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL,             -- provision_service, renew_service, ...
  key             text NOT NULL UNIQUE,      -- idempotency key
  subject_type    text,
  subject_id      uuid,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  state           text NOT NULL DEFAULT 'QUEUED'
                  CHECK (state IN ('QUEUED','RUNNING','SUCCEEDED','NEEDS_ATTENTION','CANCELLED')),
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 8,
  run_at          timestamptz NOT NULL DEFAULT now(),
  locked_at       timestamptz,
  locked_by       text,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_due_idx ON jobs (run_at) WHERE state = 'QUEUED';
CREATE INDEX jobs_attention_idx ON jobs (state) WHERE state = 'NEEDS_ATTENTION';

CREATE TABLE audit_logs (                    -- append-only
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  actor_type      text NOT NULL CHECK (actor_type IN ('STAFF','CUSTOMER','SYSTEM')),
  actor_id        uuid,
  action          text NOT NULL,             -- e.g. router.assigned
  entity_type     text NOT NULL,
  entity_id       uuid,
  customer_id     uuid,                      -- for the per-customer timeline
  request_id      text,
  ip              inet,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb   -- redacted: never secrets
);
CREATE INDEX audit_entity_idx ON audit_logs (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_customer_idx ON audit_logs (customer_id, occurred_at DESC);
CREATE INDEX audit_actor_idx ON audit_logs (actor_type, actor_id, occurred_at DESC);
-- The application role gets INSERT and SELECT only on audit_logs.
```

## 4.9 Constraint summary

| Rule | Enforced by |
|---|---|
| Each IP+port is one endpoint | `UNIQUE (host_id, port)` |
| One live host per address | partial unique index on `hosts.address` |
| One active allocation per service | `alloc_one_active_uq` |
| One in-flight (reserved/provisioning) allocation per service | `alloc_one_pending_uq` |
| One subscription per service | `UNIQUE (service_id)` |
| A purchased item extends a subscription once | `subscription_periods_item_uq` |
| One live service per router (MVP) | `services_one_live_per_router_uq` |
| Assigned routers have an owner | `CHECK` on `routers` |
| Tailscale device is LINKED iff it has a router | `CHECK` on `tailscale_devices` |
| One Tailscale device per router | `UNIQUE (router_id)` |
| One CURRENT config per service | `configs_one_current_uq` |
| Webhook replay is harmless | `UNIQUE (gateway, event_id)` |
| Payment transaction ids are unique per gateway | `payments_gateway_txn_uq` |
| Duplicate provisioning jobs collapse | `UNIQUE (jobs.key)` |
| External usernames are unique per panel | `UNIQUE (provider_instance_id, external_username)` |
| Order item shape matches its type | `CHECK` on `order_items` |
| Refunds cannot exceed the payment | `CHECK (refunded_minor <= amount_minor)` |
| Only the documented status transitions happen | trigger `payments_enforce_transition` |
| No status change without a declared actor, and every change is audited | trigger `payments_write_audit` |
| The audit log cannot be changed | trigger `payment_audit_append_only` |
| PAID needs an accountant (or later a gateway) | `CHECK` on `payments` |
| AUTO_VERIFIED means every automatic check passed | `CHECK` on `payments` |
| An order has one live payment | `payments_one_live_per_order_uq` |
| One Vodafone Cash transaction backs one payment | `UNIQUE (payments.transaction_reference)` |
| One SMS backs one payment | `UNIQUE (payments.matched_sms_id)` |
| The same SMS is stored once | `UNIQUE (device_id, message_sha256)` and `payment_sms_reference_uq` |

Index notes: most hot paths are covered by the partial indexes above
(eligible endpoints, due jobs, expiring subscriptions, items needing
attention). Add indexes only after measuring.

------------------------------------------------------------------------

# 5. State machines

Rule: a state is stored only if it changes rarely and drives behavior.
Observations (online/offline, healthy/down) are stored as cached facts,
not lifecycle states.

## 5.1 Router lifecycle

``` mermaid
stateDiagram-v2
  [*] --> IN_STOCK
  IN_STOCK --> ASSIGNED: assign customer
  ASSIGNED --> IN_STOCK: unassign (before shipment)
  ASSIGNED --> PROVISIONING: start provisioning
  PROVISIONING --> READY: verified
  PROVISIONING --> ASSIGNED: failed, retry later
  READY --> PROVISIONING: re-provision
  READY --> REPLACED: replacement completed
  IN_STOCK --> DECOMMISSIONED
  ASSIGNED --> DECOMMISSIONED
  READY --> DECOMMISSIONED
  REPLACED --> DECOMMISSIONED: physically retired
```

-   `connectivity` (ONLINE/OFFLINE/UNKNOWN) is derived from Tailscale
    `lastSeen` and agent checks. It is not part of the lifecycle.
-   Lost or stolen: `DECOMMISSIONED` with `decommission_reason = STOLEN`,
    plus credential rotation on the service and removal of the Tailscale
    node.
-   Shipping is a timestamp (`shipped_at`) and an order-item step, not a
    router state.

## 5.2 Service

``` mermaid
stateDiagram-v2
  [*] --> PROVISIONING
  PROVISIONING --> ACTIVE: allocation active + config current
  PROVISIONING --> FAILED: retries exhausted (needs admin)
  FAILED --> PROVISIONING: admin retry
  ACTIVE --> SUSPENDED: admin / abuse
  SUSPENDED --> ACTIVE: resume
  ACTIVE --> TERMINATED
  SUSPENDED --> TERMINATED
```

-   MIGRATING is not a service state. It is an allocation in
    `PROVISIONING` while the old one is still `ACTIVE`.
-   The customer-facing status is computed:

| Service | Subscription | Shown to the customer |
|---|---|---|
| PROVISIONING | any | Preparing |
| ACTIVE | ACTIVE | Active |
| ACTIVE | EXPIRED | Expired (renew to continue) |
| SUSPENDED | any | Suspended (contact support) |
| FAILED | any | Preparing (support is notified) |
| TERMINATED | any | Ended |

## 5.3 Subscription

``` mermaid
stateDiagram-v2
  [*] --> PENDING
  PENDING --> ACTIVE: service activated
  ACTIVE --> EXPIRED: period ended
  EXPIRED --> ACTIVE: renewed (same service/config/server)
  ACTIVE --> CANCELLED
  EXPIRED --> CANCELLED: grace ended / admin
```

Expiry is enforced twice: the provider user has an `expire` timestamp, and
a sweeper job marks the subscription EXPIRED and disables the proxy
account after `grace_until`.

## 5.4 Order, order item, payment

``` mermaid
stateDiagram-v2
  [*] --> PENDING_PAYMENT
  PENDING_PAYMENT --> PAID: payment succeeded
  PENDING_PAYMENT --> CANCELLED: timeout / customer cancel
  PAID --> FULFILLING: first item in progress
  FULFILLING --> COMPLETED: all items fulfilled
  PAID --> REFUNDED
  FULFILLING --> REFUNDED
  COMPLETED --> REFUNDED
```

``` mermaid
stateDiagram-v2
  [*] --> PENDING
  PENDING --> IN_PROGRESS
  IN_PROGRESS --> FULFILLED
  IN_PROGRESS --> NEEDS_ATTENTION: retries exhausted / no capacity
  NEEDS_ATTENTION --> IN_PROGRESS: admin retry / capacity added
  PENDING --> CANCELLED
  NEEDS_ATTENTION --> CANCELLED: refund path
```

Payment states (gateway payments use only the short path
INITIATED -> SUCCEEDED / FAILED / CANCELLED):

``` mermaid
stateDiagram-v2
  [*] --> INITIATED
  INITIATED --> SUCCEEDED: gateway webhook / matched notification
  INITIATED --> SUBMITTED: customer uploads a proof
  INITIATED --> EXPIRED: payment window passed
  INITIATED --> CANCELLED
  INITIATED --> FAILED: gateway failure
  SUBMITTED --> SUCCEEDED: evidence already matched
  SUBMITTED --> PROVISIONAL: proof passed, limits allow
  SUBMITTED --> NEEDS_REVIEW: otherwise
  PROVISIONAL --> SUCCEEDED: notification / statement / staff
  PROVISIONAL --> NEEDS_REVIEW: provisional window ended
  NEEDS_REVIEW --> SUCCEEDED: staff confirm / late evidence
  NEEDS_REVIEW --> FAILED: staff reject
  EXPIRED --> NEEDS_REVIEW: late matching transfer
```

Refunds are separate rows. An order is never "FAILED" after payment: a
paid order with a failing item stays PAID/FULFILLING and is visible on
the admin attention list.

While a payment is PROVISIONAL the order stays PENDING_PAYMENT. A config
item may be fulfilled with short, limited access (8.14.5). The order
becomes PAID only when the payment is SUCCEEDED.

## 5.5 Allocation, endpoint, job, replacement

``` mermaid
stateDiagram-v2
  [*] --> RESERVED
  RESERVED --> PROVISIONING
  PROVISIONING --> ACTIVE
  RESERVED --> FAILED
  PROVISIONING --> FAILED
  ACTIVE --> RETIRING: migration started
  RETIRING --> RETIRED: new allocation active
```

``` text
Endpoint:    ACTIVE <-> DRAINING | MAINTENANCE ; any -> DISABLED
             (ACTIVE = accepts new services. DRAINING = existing stay, no new.)
Job:         QUEUED -> RUNNING -> SUCCEEDED
             RUNNING -> QUEUED (retry with backoff)
             RUNNING -> NEEDS_ATTENTION (permanent error or attempts exhausted)
             NEEDS_ATTENTION -> QUEUED (admin retry)
Replacement: REQUESTED -> APPROVED -> PROVISIONING -> COMPLETED
             REQUESTED -> REJECTED | CANCELLED
```

Effective eligibility of an endpoint for a new allocation:

``` text
endpoint.status = ACTIVE
AND host.status = ACTIVE
AND endpoint.health_status = HEALTHY      (and host not DOWN)
AND provider_instance.status = ACTIVE
AND category_endpoints.status = ACTIVE
AND allocated_count < max_services
AND endpoint.protocol = category.protocol
AND (service has no router OR category.router_compatible)
```

------------------------------------------------------------------------

# 6. Modular monolith

Suggested stack (recommendation, not a requirement): TypeScript on
Node.js, PostgreSQL 16, a typed query layer (Kysely, Drizzle or Prisma),
React for both panels, and one codebase deployed as two processes: the
API and a worker. Both run from the same image.

Layers per module:

``` text
api            controllers, DTOs, request validation, authorization guards
application    use cases (the only place that orchestrates)
domain         entities, value objects, state transitions, invariants
infrastructure repositories, provider clients, gateways
```

Modules and what they own:

| Module | Owns |
|---|---|
| Auth | customers' and staff credentials, sessions, 2FA, RBAC checks |
| Customers | customer profile |
| Catalog | categories, plans, router products, category-endpoint links |
| Servers | hosts, endpoints, health, capacity, allocation queries |
| Services | services, configs, allocations, migrations |
| Subscriptions | subscriptions, periods, expiry |
| Routers | routers, replacements, lifecycle |
| Tailscale | device sync, matching, key issuing |
| Orders | orders, order items, fulfillment orchestration |
| Payments | payments, payment methods, webhook intake, transfer verification (proofs, notifications, decisions), refunds |
| Provisioning | jobs, workers, retries, reconcile |
| ProxyProviders | the `ProxyProvider` port and the Marzban adapter |
| Audit | audit log writer and reader |

Rules:

-   Controllers call use cases only. They never call Marzban, Tailscale,
    the shell or the database directly.
-   Modules talk through exported application interfaces. No module reads
    another module's tables directly.
-   Side effects (provider calls, SSH to routers, emails) run in the
    worker from `jobs`, never inside an HTTP request transaction.
-   A DB transaction never spans an external HTTP call.

Ports (interfaces; implementations live in infrastructure):

``` text
ProxyProvider
  createConfig(account, endpoint, config, expireAt, quota)  -> ExternalRef   (idempotent)
  updateConfig(account, changes)                             -> void         (idempotent)
  disableConfig(account) / enableConfig(account)
  deleteConfig(account)
  getConfig(account)                                         -> ExternalState
  getClientLink(account, endpoint, config)                   -> string
  getUsage(accounts[])                                       -> UsageMap
  getHealth(providerInstance)                                -> HealthReport

TailscaleClient
  listDevices() ; getDevice(id) ; createAuthKey(tags, ttl) ; deleteDevice(id)

RouterGateway                        (talks to the router over the tailnet)
  getStatus(router) ; applyConfig(router, version, payload) ; rollback(router)

PaymentGateway
  createCheckout(order) ; verifyWebhook(request) ; fetchTransaction(id) ; refund(payment, amount)

ProofAnalyzer      analyze(imageBytes) -> { amount, currency, txn_ref, timestamp, recipient, confidence }
                   (OCR or a vision model. Its output is data only and is schema-validated.)
ObjectStorage      put(bytes) -> key ; signedUrl(key, ttl) ; delete(key)   (private, encrypted)

SecretStore    get(ref) ; encrypt(plaintext) ; decrypt(ciphertext, keyId)
Notifier       sendEmail / sendSms / notifyStaff
```

Suggested layout:

``` text
src/
  modules/
    servers/{api,application,domain,infrastructure}/
    services/...  routers/...  orders/...  (same shape)
  shared/ (db, errors, ids, clock, audit, authz)
  workers/ (job runner, schedulers)
  main-api.ts   main-worker.ts
```

------------------------------------------------------------------------

# 7. API structure

Versioned REST under `/api/v1`. Customer and admin routes live in
separate route groups with separate authentication. Responses use
separate DTO types: the customer DTOs have no field for internal data,
so they cannot leak it by mistake.

## 7.1 Customer API (`/api/v1/customer`)

| Method | Path | Notes |
|---|---|---|
| POST | /auth/register, /auth/login, /auth/logout, /auth/password/reset | rate limited |
| GET, PATCH | /profile | own profile |
| GET | /catalog/categories | active categories with plans. No servers. |
| GET | /services | own services (list) |
| GET | /services/{id} | status, dates, location label, usage, router summary |
| GET | /services/{id}/config | the client link, only if `link_visibility` allows. Audited. |
| POST | /services/{id}/renew | creates a renewal order |
| GET | /subscriptions | own subscriptions |
| GET | /routers, /routers/{id} | own routers: model, status, firmware, assigned service |
| POST | /routers/{id}/replacement-requests | creates a request, not an action |
| GET | /orders, /orders/{id} | own orders |
| POST | /orders | checkout (header `Idempotency-Key`) |
| GET | /orders/{id}/payment-methods | enabled methods whose amount range contains the order total |
| POST | /orders/{id}/pay | start payment with a chosen method |
| GET | /payments/{id} | own payment status (what to send, exact amount, deadline) |
| POST | /payments/{id}/proofs | upload a proof image (rate limited, size and type checked) |

Webhooks (public, signature verified, no session):

``` text
POST /api/v1/webhooks/payments/{gateway}
POST /api/v1/webhooks/transfer-notifications     (forwarder phone, HMAC signed)
```

Ownership: every customer query is scoped by the authenticated
`customer_id` inside the repository (`WHERE customer_id = :auth`).
Someone else's resource returns `404`, never `403`.

## 7.2 Admin API (`/api/v1/admin`) and permissions

| Group | Operations | Permission |
|---|---|---|
| /customers | list, create, edit, view, block, invite, manage phone numbers, create service on behalf (8.13) | customers:read/write |
| /routers | register, assign, unassign, provision, reprovision, replace, ship, disable, decommission, logs | routers:read/write/provision |
| /router-replacements | list, approve, reject, execute | routers:provision |
| /config-categories, /config-plans, /router-products | CRUD, activate, assign endpoints | catalog:read/write |
| /hosts, /server-endpoints | CRUD, maintenance, drain, disable, metrics, services list, migrate | servers:read/write/migrate |
| /provider-instances | CRUD, test connection, reconcile | providers:read/write |
| /services | view, provision, retry, suspend, resume, migrate, reassign-router, rotate-credentials | services:read/write/migrate |
| /subscriptions | view, grant period, adjust expiry | subscriptions:read/write |
| /orders | view, cancel, retry fulfillment, ship router | orders:read/write |
| /payments | view, record manual payment, confirm or reject a transfer, refund | payments:read, payments:review, payments:refund |
| /payment-methods | CRUD, enable/disable, amount ranges, receiving accounts | payments:config |
| /payment-proofs | review queue: view image, extracted fields and checks, confirm, reject | payments:review |
| /transfer-notifications | list, match manually, ignore, import statement | payments:review |
| /forwarders | create, rotate key, disable, heartbeat status | payments:config |
| /tailscale/devices | list, link to router, ignore, remove | tailscale:read/write |
| /jobs | list needing attention, retry, cancel | provisioning:read/write |
| /audit-logs | search | audit:read |
| /staff-users | CRUD (super admin) | staff:write |
| /settings | grace period, thresholds, notification settings, payment switches and limits (8.14.7) | settings:write |

Revealing a secret (client link, credential) is its own permission,
`secrets:reveal`, and every reveal writes an audit row.

------------------------------------------------------------------------

# 8. Workflows

Common pattern for every workflow that touches an external system:

``` text
1. DB transaction: write the intent (rows + a job with an idempotency key).
2. Commit.
3. Worker: perform the external call (idempotent, deterministic names).
4. DB transaction: record the result and advance states.
5. On failure: retry with backoff; on permanent failure NEEDS_ATTENTION.
```

## 8.1 Purchase (config only, or router + config)

``` text
Customer
 1. POST /orders with items and Idempotency-Key.
    Item: CONFIG_NEW(plan, use_with_router?) and optionally ROUTER(product).
    A config bought with a router carries attach_to_item_id.
 2. Order PENDING_PAYMENT. Prices are snapshotted into order_items.
 3. The customer picks one of the payment methods allowed for the order amount (8.14).
    A gateway method creates a checkout. A transfer method creates a payment with a
    unique amount.

Payment confirmed (gateway webhook, matched transfer notification, or staff review; see 8.14)
 4. One transaction:
      insert payment_events (gateway payments) or mark the transfer notification MATCHED ;
      payment SUCCEEDED with its evidence_level ; order PAID
      one fulfillment job per order item (unique key per item)
 5. Return 200 quickly.

Worker, per item
 6. CONFIG_NEW  -> workflow 8.2
 7. ROUTER      -> workflow 8.5 (staff-driven)
 8. When every item is FULFILLED -> order COMPLETED.
```

Amount and currency from the gateway are compared with the order total
before PAID. Any mismatch stops and raises an admin alert.

## 8.2 Config provisioning (new service)

``` text
Transaction A (reservation)                         [DB only]
  a. Re-check the order item is not already fulfilled
     (services.origin_order_item_id is unique: a retry resumes the same service).
  b. Insert services (PROVISIONING), subscriptions (PENDING).
  c. Select and reserve an endpoint (workflow 8.3) -> service_allocations RESERVED.
  d. Insert configs (version 1, PENDING) with a new client UUID.
  e. Insert provisioning job.
Commit.

Worker                                               [external]
  f. allocation PROVISIONING.
  g. ProxyProvider.createConfig with the deterministic username
     (cb-sv-<service code>) and the endpoint's inbound only.
     "Already exists" is success after verifying the existing user matches.
  h. ProxyProvider.getClientLink and a smoke check.

Transaction B (activation)
  i.  proxy_account ACTIVE ; allocation ACTIVE ; config CURRENT.
  j.  Standalone service: service ACTIVE ; subscription starts now
      (starts_at = now, current_period_end = now + duration) ; push expire to the provider.
  k.  Router-bound service: stays PROVISIONING until the router is READY and shipped
      (workflow 8.5). A provisional expiry on the proxy user is the failsafe.
  l.  order item FULFILLED.
```

Failure handling:

| Failure | Behavior |
|---|---|
| Provider timeout or 5xx | Job retries with backoff. State unchanged. |
| Provider 4xx (bad request) | Permanent: job NEEDS_ATTENTION, service FAILED, admin alert. |
| Endpoint went down mid-provisioning | Release the reservation (decrement counter, allocation FAILED), reserve another endpoint, continue. The credential and service stay the same. |
| Worker crashes after step g | The retry re-runs g safely (user already exists) and continues. |
| No eligible endpoint | See 8.9. |

## 8.3 Server allocation

``` text
Candidates (single query):
  eligible endpoints of the category (see section 5.5), ordered by
  load ratio  allocated_count / max_services  divided by weight,
  then by category_endpoints.priority, then by id.

For each candidate in order (small N):
  UPDATE server_endpoints
     SET allocated_count = allocated_count + 1
   WHERE id = :id AND status = 'ACTIVE'
     AND allocated_count < max_services
  RETURNING ...;
  0 rows  -> someone else took the last slot or it changed: try the next candidate.
  1 row   -> insert the allocation (RESERVED) in the same transaction. Done.
```

The conditional update is an atomic check-and-increment. Two concurrent
purchases cannot both take the last slot, and no explicit lock, queue or
Redis is needed. A nightly job recomputes `allocated_count` from the
allocation rows and fixes drift.

Releasing: when an allocation becomes FAILED or RETIRED, decrement in the
same transaction that changes its status.

Selection is sticky: this algorithm runs only for INITIAL and MIGRATION
allocations. Renewal never calls it.

## 8.4 Renewal

``` text
 1. POST /services/{id}/renew -> order with CONFIG_RENEWAL(target_service, plan).
    The plan must belong to the service's category.
 2. Payment confirmed -> fulfillment job.
 3. One transaction:
      insert subscription_periods (unique on order_item_id)
      start = max(now, current_period_end) if ACTIVE ; now if EXPIRED
      end   = start + plan duration ; quota per plan rules
      subscription ACTIVE, current_period_end = end ; clear grace_until
      order item FULFILLED
 4. Worker: push the new expire/quota to the provider (idempotent update).
    If the proxy account was disabled by expiry, enable it.
```

Not done on renewal: no endpoint selection, no allocation row, no new
config version, no router change. The result is the same service, same
config identity, same server, a later expiry.

A second webhook or a retried job hits the unique index on
`subscription_periods.order_item_id` and becomes a no-op.

## 8.5 Router provisioning (staff-driven)

Preparation (warehouse, before shipping):

``` text
 1. Flash OpenWrt. Install Cowboy Bebop Manager, sing-box, Tailscale.
 2. Staff creates the router record (status IN_STOCK): serial, device id, model.
 3. Backend issues a single-use, tagged, short-lived Tailscale auth key
    (shown once to staff, never stored).
 4. Router joins with hostname cb-<serial> and tag:router.
 5. Device sync finds it. Because the hostname carries the serial, the
    backend proposes the match; staff confirm -> tailscale_devices LINKED.
```

Assignment and provisioning:

``` text
 6. Order item ROUTER: staff pick an IN_STOCK router -> ASSIGNED to the customer.
 7. If a config was bought with it, its service already exists (8.2), with router_id set.
 8. Staff press Provision -> router PROVISIONING -> job:
      a. RouterGateway.getStatus: reachable, manager + sing-box versions acceptable.
      b. applyConfig(config_version, client link). The router's own apply
         flow validates, backs up and rolls back if its checks fail.
      c. Verify: tunnel up, DNS works, a test request through the proxy succeeds.
 9. Router READY ; record applied_config_version ; order item FULFILLED when shipped.
10. Staff press Ship: router.shipped_at set ; service ACTIVE ;
    subscription starts ; expire pushed to the provider.
11. First time the router appears online at the customer: first_online_at set.
```

If the router was shipped before the config was ready, the order item stays
IN_PROGRESS and the router stays PROVISIONING until the config is applied
remotely over the tailnet.

## 8.6 Router replacement

``` text
Customer: POST /routers/{id}/replacement-requests (reason)  -> REQUESTED
Staff:
 1. Review; choose or register the replacement router; approve (-> APPROVED).
 2. Assign the new router to the same customer.
 3. In one transaction: services.router_id = new router (the "one live service per
    router" index frees the old one first).
 4. If rotate_credentials: create config version n+1 (new client UUID), push to the
    provider, mark the old version SUPERSEDED. The subscription and the allocation
    are untouched.
 5. Provision the new router (8.5 steps 8-9).
 6. New router READY -> old router REPLACED (replaced_by_router_id set), then
    DECOMMISSIONED when physically retired. Remove its Tailscale node.
 7. Replacement COMPLETED. No order, no new subscription.
```

If the old router is lost or stolen, rotation is not optional: the old
credential must stop working.

## 8.7 Server migration (admin only)

``` text
Trigger: endpoint being decommissioned, failure, or admin decision. Never renewal.

For each service on the source endpoint (one at a time, resumable):
 1. Admin chooses a target endpoint (or the system proposes eligible ones).
 2. Transaction: reserve a new allocation (reason MIGRATION, supersedes_id = old,
    created_by = admin, note = reason). The old allocation stays ACTIVE.
 3. Worker: provision at the target (new inbound on the same panel, or a new proxy
    account on another panel). The client credential does not change.
 4. Verify the new path.
 5. Transaction: old allocation RETIRING -> RETIRED, new allocation ACTIVE,
    counters adjusted. Audit row written.
 6. Router-bound service: RouterGateway.applyConfig with the new link (the router's
    commit-confirm/rollback protects it). Standalone service: the customer's link
    changes; notify the customer.
 7. Remove the user from the old endpoint after a grace period.
```

If any step fails, the old allocation remains ACTIVE and the service keeps
working. Draining an endpoint first (no new allocations) reduces the
number of migrations.

## 8.8 Payment succeeded, provisioning failed

``` text
Order stays PAID/FULFILLING. The item is IN_PROGRESS (retrying) or NEEDS_ATTENTION.
Customer sees: "Preparing your service". No broken link is shown.
Admin sees: the item on the attention list with the last error.
Actions: retry, change endpoint, add capacity, cancel the item and refund.
Time limit: a setting (for example 24 h) after which support is alerted and a
refund is offered. Subscription time starts only on activation, so the customer
loses nothing while it fails.
```

## 8.9 No eligible server

``` text
1. Allocation finds no candidate.
2. Service stays PROVISIONING, order item NEEDS_ATTENTION with reason NO_CAPACITY.
3. No config is created at the provider, no subscription time starts, the category is
   never switched silently, and no offline endpoint is used.
4. Staff are notified (email and dashboard).
5. The job re-runs automatically when capacity changes (endpoint enabled, capacity
   raised, a service terminated) and on a timer.
6. Optionally the customer is offered another category or a refund.
```

## 8.10 Expiry sweep

``` text
Every few minutes:
  subscriptions ACTIVE with current_period_end < now -> EXPIRED, grace_until set.
  after grace_until: disable the proxy account (the provider expire already enforces it).
  after the retention period: service TERMINATED, provider user deleted, allocation
  RETIRED and the endpoint counter released.
Renewal during grace or retention reactivates the same service, config and endpoint.
```

## 8.11 Admin workflows

``` text
New customer          create customer -> optional first order on their behalf
New server            pick or create host -> add endpoint (port, inbound tag, capacity)
                      -> health check -> attach to categories -> ACTIVE
Server maintenance    Drain -> wait or migrate -> Maintenance -> back to Active
New category          create (DRAFT) -> plans -> attach endpoints -> ACTIVE
New router device     Tailscale device appears (NEW) -> link or create router -> assign
                      -> provision -> ship
Router replacement    8.6
Service issues        view allocation history, retry provisioning, suspend/resume,
                      rotate credentials, migrate
Finance               record manual payment, refund (needs payments:refund)
```

## 8.12 Customer workflows

``` text
Register -> verify email -> browse categories -> choose plan -> choose
"use with my router" or "standalone" -> pay -> dashboard shows Preparing -> Active.
Dashboard: services with status, start, expiry, location label, usage, router, [View config], [Renew].
Routers: own routers with status and assigned service. Replacement request button.
```

Customer-visible fields (allow-list; everything else is excluded by DTO):

| Entity | Visible |
|---|---|
| Service | code, label, category name, computed status, start, expiry, location label (country/city), usage, router code and status |
| Config | the client link, only when the category policy allows |
| Router | code, model, firmware version, connectivity, assigned service |
| Order | items, prices, status |

Never visible: internal ids of hosts/endpoints, provider data (Marzban
usernames, inbound tags, panel URLs), Tailscale data, health or load data,
other customers, staff identities.

## 8.13 Customer and service created manually by an admin

Used for customers who did not go through checkout (phone or in-person
sales, gifts, test accounts).

``` text
1. Create the customer (admin). Status INVITED, no password yet.
   Optional: "Send invitation" -> an auth_tokens row (purpose INVITE, only the hash is
   stored) and an email/SMS link. The customer sets a password -> status ACTIVE.
   Without an invitation the customer simply has no login yet; staff manage everything.
2. Create a service on behalf of the customer (permission customers:write plus
   subscriptions:write): category, plan, optional router, optional start date,
   mandatory reason.
3. The system runs the normal provisioning workflow (8.2, steps c-l): it reserves an
   endpoint, creates the config and the provider user, and activates the service.
   Differences: no order item exists (services.origin_order_item_id stays NULL), the job
   key is based on the service id, and the subscription time comes from an
   ADMIN_GRANT row in subscription_periods (source ADMIN_GRANT, created_by_staff_id set).
4. If a router is involved: register or pick the router, assign it to the customer, link
   the service (router_id), then 8.5 steps 8-10.
5. If the customer paid cash and you want it in the books: do not skip the order. Create
   a normal order and record a manual payment (finance permission). It then flows through
   8.1 and 8.2, so the accounting trail exists.
6. Every step writes an audit row, including who granted the time and why.
```

Two accepted ways to create a manual service:

| Case | Path |
|---|---|
| Free or granted time (gift, test, compensation) | admin-created service with an ADMIN_GRANT period, no order |
| Paid outside the website | normal order plus a manual payment recorded by finance |

Importing a config that already exists on a Marzban panel (an existing
user, with the same link) is not part of this design. It can be added
later with an `IMPORT` allocation reason and an "externally created" flag
on the proxy account so the reconcile job never deletes it.

## 8.14 Payment methods and verification

Small plans (15 and 30 EGP) cannot carry a card gateway fee of
2.75% + 3 EGP plus VAT on the fee: about 26% of 15 EGP, 14.5% of 30 EGP
and 7.7% of 75 EGP. So payment methods are chosen by amount: **cards are
offered from 75 EGP**, and cheap transfer methods are verified
automatically where possible. Published fee numbers change: confirm them
with the providers before deciding.

### 8.14.1 Methods by amount

Methods are rows in `payment_methods`, not code.

| Code | Kind | Typical use | Verification |
|---|---|---|---|
| CARD | GATEWAY | order total of **75 EGP and above** (`min_amount_minor = 7500`) | gateway webhook |
| WALLET_GATEWAY | GATEWAY | any amount, if the quoted rate is acceptable | gateway webhook |
| INSTAPAY_TRANSFER | TRANSFER | any amount (the cheapest option, the only one below 75 EGP) | matched notification, else staff review |
| WALLET_TRANSFER | TRANSFER | any amount (the only other option below 75 EGP) | matched notification, else staff review |
| CASH | MANUAL | cash sales | staff |

`GET /orders/{id}/payment-methods` returns the enabled methods whose
`min_amount_minor`/`max_amount_minor` contain the order total:

``` text
enabled AND kind <> 'MANUAL'
        AND min_amount_minor <= order.total_minor
        AND (max_amount_minor IS NULL OR max_amount_minor >= order.total_minor)
```

MANUAL methods (cash) are recorded by staff only and are not offered
through the customer API.

The card minimum applies to the order total, not to each item. A cart of
15 + 30 EGP (45 EGP) gets transfer methods only. A cart of 80 EGP also
gets cards. The owner can change the minimum at any time in the admin
panel (`/payment-methods`) without a deployment.

Initial data:

``` sql
INSERT INTO payment_methods
  (code, display_name, kind, gateway, verification, min_amount_minor, max_amount_minor)
VALUES
  ('CARD',              'Card',                  'GATEWAY',  'paymob', 'GATEWAY',      7500, NULL),
  ('INSTAPAY_TRANSFER', 'InstaPay transfer',     'TRANSFER', NULL,     'NOTIFICATION',    0, NULL),
  ('WALLET_TRANSFER',   'Mobile wallet transfer','TRANSFER', NULL,     'NOTIFICATION',    0, NULL),
  ('CASH',              'Cash',                  'MANUAL',   NULL,     'STAFF',           0, NULL);
-- 'paymob' is a placeholder adapter name: use the gateway you choose.
-- Add WALLET_GATEWAY only after you have a quote you accept.
```

### 8.14.2 Transfer payment flow

``` text
1. The customer picks a transfer method. The backend creates a payment:
     reference_code        short code (for support and matching by staff)
     suffix_minor          1-99 piastres, chosen so that
                           (method_code, expected_amount_minor) is unique among
                           open payments (partial unique index)
     expected_amount_minor total + suffix (for example 15.37 EGP)
     expires_at            now + payment window (setting)
     status                INITIATED
   The customer sees: the receiving account, the exact amount, the reference code
   and the deadline. If no free suffix exists for that amount, the customer is
   asked to retry in a few minutes.

2. The customer sends exactly that amount.

3a. Notification path (automatic, preferred)
    The forwarder posts the incoming-money message (8.14.6). The worker parses it and
    looks for ONE open payment with the same method, the exact expected amount, inside
    its window. One transaction: lock the payment row, mark the notification MATCHED,
    payment SUCCEEDED (evidence NOTIFICATION), order PAID, fulfillment jobs.
    The customer does not need to upload anything.

3b. Proof path (fallback)
    The customer uploads a screenshot. Payment becomes SUBMITTED, a job analyzes it
    (8.14.4) and a decision is made (8.14.3).

4. Expiry
    An INITIATED payment past `expires_at` becomes EXPIRED. A matching transfer that
    arrives later (within `payment.late_match_hours`) moves it to NEEDS_REVIEW, never
    straight to SUCCEEDED, because the amount may have been reused.
```

The suffix means the customer pays up to 0.99 EGP more than the plan
price. Show it clearly. The suffix is stored separately; decide whether
to keep it as rounding or credit it.

### 8.14.3 Evidence and decisions

| Evidence | Trust | Can confirm alone? |
|---|---|---|
| Gateway webhook (verified, transaction re-fetched) | high | yes |
| Matched notification (exact amount, window, unique, signed forwarder, allowed sender) | high | yes |
| Matched statement line (reconciliation, next day) | high | yes |
| Staff confirmation (mandatory reason, audited) | high | yes |
| Customer screenshot | low | never |
| Reference number typed by the customer | low | never |

Decision after a proof was analyzed:

``` text
proof PASS and a notification or statement line already matched  -> SUCCEEDED
proof PASS and no notification yet:
    provisional access allowed (8.14.5)   -> PROVISIONAL, wait for evidence
    otherwise                             -> NEEDS_REVIEW (customer sees "Verifying")
proof REVIEW or FAIL                      -> NEEDS_REVIEW with the failed checks listed
```

A matching notification that arrives later upgrades PROVISIONAL or
NEEDS_REVIEW to SUCCEEDED automatically.

### 8.14.4 Proof checks (run in the worker, never in the request)

``` text
File        allow-list jpg/png/webp, size limit, dimension limit, no animation,
            re-encode to strip metadata, store privately.
Duplicates  sha256 of the re-encoded image is unique. Perceptual hash is compared with
            existing proofs of other payments (near-duplicates go to review).
Extraction  OCR or vision model returns a strict schema {amount, currency, txn_ref,
            timestamp, recipient, confidence}. Arabic-Indic digits are normalized.
Checks      amount equals expected_amount exactly
            recipient matches the method's receiver_match
            timestamp inside [payment created - 5 min, expires_at + 5 min]
            txn_ref present, and not already used by another passed proof
            extraction confidence above the threshold
Result      PASS, REVIEW or FAIL stored with every check's outcome.
```

Limits of this step, stated plainly: a good forgery passes all of these
checks. That is why a proof never confirms a payment on its own.

Safety of the analysis: text inside an image is data. The analyzer has no
tools and no access to the system, its output is validated against the
schema, and nothing extracted is ever executed or used as an instruction
(this blocks prompt injection through image text). Prefer running OCR
locally. If a cloud model is used, review what is sent, because the image
contains personal data.

### 8.14.5 Provisional access (optional, off by default)

Purpose: do not make the customer wait for a person when the evidence is
likely but not confirmed yet.

Rules (all must hold):

-   `provisional.enabled` is true.
-   Only CONFIG items. Never routers.
-   Only methods verified by notification.
-   The customer already has at least one SUCCEEDED payment. New customers
    never get provisional access.
-   The proof decision is PASS.
-   Caps: amount at most `provisional.max_amount_minor`; at most
    `provisional.max_outstanding_per_customer` provisional payments per
    customer; total provisional exposure across all customers at most
    `provisional.max_total_exposure_minor`.

What the customer gets: not the whole plan. The subscription gets a short
period with source PROVISIONAL (no order item, `provisional.hours`,
default 24 h).

``` text
Evidence arrives  -> payment SUCCEEDED, the full ORDER period is inserted
                     (unique on order_item_id) starting at the provisional start.
Nothing arrives   -> access ends by itself at the provisional end (no revoke job),
                     payment goes to NEEDS_REVIEW, the customer loses eligibility
                     after repeated failures.
```

The worst loss is bounded by the caps and the short window.

### 8.14.6 Notification forwarder

A dedicated phone, with the SIM or wallet account that receives the
transfers, runs a small forwarder app.

``` text
Phone receives "money received" message
  -> app posts it to POST /webhooks/transfer-notifications
       headers: forwarder id, timestamp, nonce, HMAC-SHA256 of the body
  -> backend: verify HMAC, reject if the timestamp is older than 2 minutes or the
     nonce was already seen, accept only allow-listed sender ids, parse with a strict
     per-sender parser, store raw text + hash (duplicates collapse), parse amount,
     reference and time.
  -> unknown format or sender -> UNPARSEABLE (shown in a review list, never guessed).
```

Heartbeat: the app calls in every minute. If it is silent longer than
`forwarder.max_silence_minutes`, automatic confirmation and provisional
access switch off and staff are alerted (fail closed). The forwarder key
is stored in the secret store and can be rotated and revoked.

A message's sender name can be spoofed, so a matched message is trusted
only together with the exact amount, the window, uniqueness, and the daily
reconciliation below.

### 8.14.7 Settings (table `settings`)

Values are suggestions. The owner decides.

| Key | Suggested | Meaning |
|---|---|---|
| payment.transfer_window_minutes | 30 | how long a transfer payment waits |
| payment.late_match_hours | 24 | a late matching transfer goes to review |
| autoconfirm.enabled | false until a forwarder is running | automatic confirmation from notifications |
| autoconfirm.max_amount_minor | 30000 | above this, staff review even if matched |
| provisional.enabled | false | 8.14.5 |
| provisional.hours | 24 | length of provisional access |
| provisional.max_amount_minor | 3000 | per payment |
| provisional.max_outstanding_per_customer | 1 | |
| provisional.max_total_exposure_minor | 50000 | across all customers |
| forwarder.max_silence_minutes | 10 | fail-closed trigger |
| proof.max_size_bytes | 5242880 | upload limit |
| proof.max_per_payment | 3 | uploads per payment |
| proof.retention_days | 90 | image deleted after this (row kept) |
| payments.dual_approval_minor | 20000 | manual confirmation above this needs a second staff member |

### 8.14.8 Reconciliation and fail-closed behavior

``` text
Daily       Compare SUCCEEDED transfer payments with the bank/wallet statement
            (manual now, statement import later). A payment with no matching line
            is flagged: the service is suspended, the customer loses provisional
            eligibility, and finance investigates.
Reports     Daily count and total of auto-confirmed, provisional and manually
            confirmed payments, by evidence_level.
Fail closed Forwarder silent, parser failure rate above a threshold, or a
            reconciliation mismatch -> autoconfirm.enabled and provisional.enabled
            switch off automatically; everything goes to NEEDS_REVIEW.
Manual      A manual confirmation needs a reason and is audited. Above
            payments.dual_approval_minor a second staff member must approve.
```

### 8.14.9 What the customer sees

| Payment status | Message |
|---|---|
| INITIATED | "Send exactly X EGP to ... before HH:MM" with a countdown |
| SUBMITTED, NEEDS_REVIEW | "Verifying your payment" |
| PROVISIONAL | "Active for 24 hours while we confirm your payment" |
| SUCCEEDED | normal active service |
| EXPIRED | "The payment window ended. Start again." |

------------------------------------------------------------------------

# 9. Proxy provider integration (Marzban)

Ownership:

``` text
App DB      customers, routers, services, configs, subscriptions, allocations, orders
Marzban     proxy users, Xray inbounds, traffic counters, runtime state
Mapping     service -> proxy_account (external_username) -> provider_instance
            allocation -> endpoint -> provider_inbound_tag
```

Design:

-   `MarzbanProvider` implements `ProxyProvider`. Business code only sees
    the port.
-   One user per service per panel. The external username is derived from
    the service code (`cb-sv-000123`), so retries cannot create
    duplicates.
-   The client UUID is generated by the app and sent to Marzban (not
    generated there), so the credential identity is stable and under our
    control.
-   The user is restricted to the inbound of the assigned endpoint. This
    enforces stickiness at runtime and keeps the link to a single
    server entry.
-   `expire` and `data_limit` are pushed from the subscription. The
    provider enforces them even if the app is down.
-   Create is "get, then create". A conflict is treated as success after
    comparing the existing user with the intended one.
-   Authentication: the admin credential is read from the secret store,
    the token is cached in memory and refreshed on 401. Credentials never
    reach the DB, logs or any customer response.
-   Errors: timeouts and 5xx are transient. 4xx are permanent. A simple
    per-panel circuit breaker pauses new allocations to hosts of a panel
    that is failing.
-   Pin the supported Marzban version and keep a contract test suite that
    runs against a real instance in CI. Confirm exact field names and
    endpoints against the version you deploy.

Background jobs:

| Job | Frequency | Purpose |
|---|---|---|
| Health check | 1 min | panel reachable, node status, host CPU/RAM into `hosts` |
| Usage sync | 5-15 min | `used_bytes` into `subscriptions` (cache for the dashboard) |
| Reconcile | nightly | orphan users, missing users, expire/limit/status drift: report and optionally fix |
| Counter reconcile | nightly | recompute `allocated_count` |

The customer dashboard reads the cached usage, never the provider, so a
panel outage does not break the dashboard.

------------------------------------------------------------------------

# 10. Tailscale and router management

Tailscale is a management channel only. It is not a customer identity, a
subscription identity or a proxy identity.

``` text
Backend / admins  ---tailnet--->  Router (OpenWrt)
Customers are never on the tailnet.
```

Device discovery:

-   `TailscaleClient.listDevices()` runs on a timer (one call lists all
    devices). New devices go to `tailscale_devices` with status NEW.
-   A device whose hostname matches a router serial is proposed as a
    match. Staff confirm. Linking sets `router_id` and status LINKED.
-   `online` and `last_seen_at` update the router's `connectivity` and
    `last_seen_at`. Check exact API field names against the current API.

Security design:

-   Auth keys are single-use, tagged `tag:router`, with a short expiry,
    generated at preparation time and shown once. Only a key id is
    stored.
-   Disable node key expiry for routers (or manage renewal), otherwise
    routers drop off silently.
-   Tailnet policy (illustrative, verify syntax against current docs):

``` json
{
  "tagOwners": { "tag:backend": ["group:admins"], "tag:router": ["group:admins"] },
  "acls": [
    { "action": "accept", "src": ["tag:backend", "group:admins"], "dst": ["tag:router:22,80,443"] }
  ]
}
```

-   Anything not listed is denied. In particular router-to-router is
    denied, so one customer's router can never reach another.
-   The backend's SSH key for routers is restricted on the router with a
    forced command (a small wrapper that only allows `status`, `apply`,
    `rollback`, `version`). A compromised backend cannot become a general
    shell on every router.
-   The Tailscale API credential (OAuth client) is scoped and lives in the
    secret store.

Router management contract (router side, lightweight shell, no new
runtime). Commands the backend may call, all with `--json` output:

``` text
cb-remote status     manager/sing-box/openwrt versions, tunnel state, applied config version
cb-remote apply      stdin: { config_version, proxy_url, options } ; validate, back up,
                     apply, check, commit or roll back ; idempotent per config_version
cb-remote rollback   restore the previous working configuration
cb-remote version
```

These wrap the manager's existing validate/apply/rollback flow and its
commit-confirm timer. The proxy runtime and the management channel are
separate: if the backend or Tailscale is unreachable, the router keeps
running its last valid configuration.

Future pull model (no schema change needed): the router periodically asks
the backend for its desired `config_version` over the tailnet, compares it
with `applied_config_version`, downloads, validates, applies and reports.
The columns `desired_config_version` and `applied_config_version` already
exist for it.

------------------------------------------------------------------------

# 11. Security

## 11.1 Authentication and sessions

-   Passwords with argon2id. Login rate limiting and temporary lockout.
-   Customers and staff are separate principals with separate session
    scopes. Sessions use httpOnly, Secure, SameSite cookies with CSRF
    tokens on state-changing requests. Sessions are revocable
    (`auth_sessions`).
-   Staff: mandatory TOTP 2FA. The admin app runs on its own listener,
    reachable only from the tailnet or an IP allowlist.

## 11.2 Authorization

Customer: ownership enforced in the repository layer for every query
(`customer_id = authenticated customer`). Customer-supplied ids are never
trusted. Not found and not yours look the same (404).

Staff: a static role-to-permission map in code. A single `role` column is
enough for the MVP. Dynamic roles can wait.

| Permission group | SUPER_ADMIN | ADMIN | SUPPORT | TECHNICIAN | FINANCE |
|---|---|---|---|---|---|
| customers read/write | yes | yes | yes | read | read |
| services read | yes | yes | yes | yes | read |
| services write (suspend, retry) | yes | yes | suspend/resume | yes | no |
| services migrate, rotate credentials | yes | yes | no | yes | no |
| subscriptions read | yes | yes | yes | yes | yes |
| subscriptions write (grant, adjust) | yes | yes | request only | no | no |
| routers read | yes | yes | yes | yes | no |
| routers write, provision, replace | yes | yes | no | yes | no |
| hosts/endpoints/providers read | yes | yes | no | yes | no |
| hosts/endpoints/providers write | yes | yes | no | yes | no |
| catalog write | yes | yes | no | no | no |
| orders read | yes | yes | yes | read | yes |
| payments read, record manual | yes | yes | read | no | yes |
| payments review (confirm or reject transfers and proofs) | yes | no | no | no | yes |
| payment methods, forwarders, payment settings | yes | no | no | no | no |
| refunds | yes | no | no | no | yes |
| secrets:reveal | yes | yes | no | yes | no |
| staff management, settings | yes | no | no | no | no |
| audit read | yes | yes | no | no | read (payments) |

Two ideas worth keeping from the start: the "reveal a secret" permission
and the rule that refunds are not available to a broad ADMIN.

## 11.3 Data protection

-   TLS everywhere. HSTS on the public hosts.
-   Client UUIDs are encrypted at the application level with a key id for
    rotation. Provider and Tailscale credentials live in a secret store
    (environment or a secrets manager), and the DB holds only references.
-   PII (names, phones, address) is minimized in logs and audit metadata.
    Check local data-protection rules (for example Egypt's Personal Data
    Protection Law) for consent, retention and deletion requirements.
-   Rate limiting on login, registration, password reset, checkout and
    webhooks. Input validation at the API boundary.
-   Payment data: do not store card data. Keep only gateway references.
-   Webhooks: verify the signature, then fetch the transaction from the
    gateway and compare amount and currency before trusting it.

## 11.4 Audit

Every staff mutation and every secret reveal writes an `audit_logs` row
(actor, action, entity, customer, request id, IP, redacted metadata).
Customer-visible actions that matter (login, renew, replacement request)
are logged too. The table is append-only for the application role.

Minimum action list: customer created/edited, router created/assigned/
provisioned/replaced/decommissioned, category and plan changes, endpoint
assigned to a category, service created/provisioned/suspended/migrated/
credentials rotated, subscription granted/adjusted, endpoint
disabled/drained, order cancelled, payment recorded, refund issued, secret
revealed, staff login and role changes, payment confirmed/rejected (with
evidence level), proof viewed, forwarder key rotated, payment setting
changed.

## 11.5 Payment verification security

Absolute (100%) security does not exist for any system. The goals here
are: no unbounded loss, everything detectable, and failures that stop
automation instead of continuing blindly.

Guaranteed by design:

-   No payment becomes SUCCEEDED without evidence (a `CHECK` constraint
    and the code).
-   A screenshot never confirms a payment alone.
-   A notification, a bank reference, an image file and an expected
    amount can each be used once (unique indexes).
-   Provisional access is off by default, never applies to routers or to
    new customers, and is capped in amount, count and total exposure.
-   Failures (silent forwarder, parse errors, reconciliation mismatch)
    switch automation off.

| Threat | Control | Residual risk |
|---|---|---|
| Forged or edited screenshot | never confirms alone; needs notification, statement or staff | loss limited to the provisional caps |
| Same screenshot or reference reused | `sha256` unique, perceptual hash, `txn_ref` unique | an edited image with a new reference still needs real money to confirm |
| Wrong recipient or wrong amount | exact checks on amount and receiver; unique amount per open payment | none on the automatic path |
| Fake message to the forwarder phone | allow-listed senders, strict parser, exact amount and window, `autoconfirm.max_amount_minor`, daily reconciliation | a spoofed message can confirm until reconciliation catches it; keep the limit low |
| Forwarder phone lost, stolen, offline or SIM swapped | per-forwarder HMAC key (revocable), heartbeat, fail closed | payments wait for staff while it is down |
| Replay of a forwarder request | timestamp window, nonce, HMAC | none |
| Staff abuse | split permissions, mandatory reason, audit, dual approval above a threshold, daily reports | collusion of two staff |
| Prompt injection through image text | analyzer has no tools, schema-validated output, data only | a wrong extraction goes to review |
| Malicious upload | allow-list, size and dimension limits, re-encode, never executed, private storage | none known |
| Personal data in images | private encrypted storage, short-lived signed URLs, access audit, retention purge | exposure if storage credentials leak |
| Upload abuse | rate limits, at most `proof.max_per_payment` uploads | none |
| Customer dispute | evidence and audit trail kept for the retention period | none |
| Amount suffix collision | partial unique index; the customer retries | brief delay |

Operating rules: use business accounts for receiving, not personal ones;
check the wallet and InstaPay terms and local tax rules; rotate the
forwarder key regularly; review the daily report.

------------------------------------------------------------------------

# 12. Integrity, concurrency and idempotency

| Risk | Control |
|---|---|
| Duplicate webhook | `UNIQUE (gateway, event_id)` in `payment_events` |
| Duplicate checkout request | `Idempotency-Key` with `UNIQUE (customer_id, idempotency_key)` |
| Duplicate fulfillment | job key per order item; `services.origin_order_item_id` unique |
| Duplicate provider user | deterministic username + get-before-create + unique `(provider_instance_id, external_username)` |
| Duplicate renewal | `subscription_periods.order_item_id` unique |
| Same transfer matched twice | `UNIQUE (matched_payment_id)` and `UNIQUE (method_code, txn_ref)` on notifications |
| Two buyers expect the same transfer amount | `payments_open_expected_uq` (partial unique index) |
| Same screenshot or bank reference reused | `payment_proofs.sha256` unique, `payment_proofs_txn_ref_uq` |
| Notification arrives before or after the proof | matching works on payments in INITIATED, SUBMITTED, NEEDS_REVIEW and PROVISIONAL; late ones go to review |
| Forwarder goes silent | heartbeat check switches automation off |
| Two buyers take the last slot | conditional `UPDATE ... WHERE allocated_count < max_services` |
| Counter drift | nightly recompute from allocation rows |
| Endpoint dies during provisioning | release reservation, reserve another, same credential |
| Payment succeeded, provisioning failed | order stays open, item NEEDS_ATTENTION, retries, admin alert |
| Worker crash mid-job | jobs are idempotent per step, locked with `FOR UPDATE SKIP LOCKED` and a lease |
| Router replaced while a job runs | the "one live service per router" index and a job guard on `router_id` |
| Concurrent migration and renewal | renewal only touches the subscription; migration only touches allocations |

Job claiming:

``` sql
SELECT * FROM jobs
 WHERE state = 'QUEUED' AND run_at <= now()
 ORDER BY run_at
 FOR UPDATE SKIP LOCKED
 LIMIT 10;
```

Why not Redis or a distributed lock: all contention is on rows in one
PostgreSQL database. Constraints and conditional updates are correct and
simpler than an extra system.

------------------------------------------------------------------------

# 13. Scale path

Introduce a component only when the trigger appears. Rough thresholds are
starting points to revisit with measurements.

| Component | Trigger | Before that |
|---|---|---|
| Background jobs | day one | DB-backed `jobs` table and a worker process |
| Redis (rate limit, cache, sessions) | more than one API instance, or login/API load that needs shared counters | in-process limits, DB sessions |
| Queue system (BullMQ or similar) | job volume or scheduling needs beyond what polling a table handles (many per second) | `FOR UPDATE SKIP LOCKED` |
| Prometheus + Grafana | roughly 20-50 servers or when historical graphs and alerting are needed | health columns in `hosts`, a simple dashboard, uptime checks |
| Distributed locking | not expected | constraints and conditional updates |
| Caching | repeated heavy reads (catalog, dashboard) | indexes |
| Read replica | reporting load hurts the primary | single primary |
| Table partitioning (audit logs, usage samples) | tens of millions of rows | single tables with indexes |
| Splitting out a worker/fleet service | router fleet of ~1,000+ routers, or provider calls dominate CPU | worker process in the same codebase |
| Pull-based router agent | when push over SSH stops scaling or NAT/availability issues grow | push via the tailnet |

Sizing guide:

| Scale | What changes |
|---|---|
| 10 routers, 5 servers, 100 services | one app + worker + PostgreSQL. Nothing else. |
| 100 routers, 50 servers, 10k services | poll Tailscale in one API call, batch provider reconcile, add basic metrics |
| 1,000 routers | pull-based sync, staggered polling, fleet dashboard filters |
| 10,000 routers, 500 servers, 100k services | separate worker deployment, Redis, queue, metrics stack, partitioned logs, consider a fleet service |

------------------------------------------------------------------------

# 14. MVP and future

## 14.1 MVP

-   Customers, staff, auth, RBAC, 2FA for staff.
-   Config categories, plans, router products.
-   Hosts, endpoints, category-endpoint links, health checks, capacity.
-   Server allocation (sticky), allocation history.
-   Marzban provider (create, update, disable, usage, health), reconcile.
-   Services, configs, subscriptions, renewals, expiry sweep.
-   Orders, payments (one gateway plus manual), refunds, webhook dedupe.
-   Payment methods by amount; transfer payments (InstaPay, wallet) with unique
    amounts, proof review and notification matching; provisional access (off by
    default); payment settings and daily reconciliation report.
-   Routers, assignment, Tailscale device sync and matching, router
    provisioning and replacement (push over the tailnet).
-   Customer dashboard and admin dashboard, attention list.
-   Audit logs, basic notifications (email), basic monitoring.

## 14.2 Future

-   Automatic migration on failures; load-aware balancing.
-   Pull-based remote config sync with desired/applied versions.
-   Prometheus and Grafana; usage time series.
-   Additional proxy providers behind the same port.
-   Automated firmware updates and fleet management.
-   Several services per router (needs router-side multi-profile).
-   Queue system and a larger background job platform.
-   Self-service replacement and paid replacement flows.
-   Statement import and bank/wallet APIs as automatic evidence sources.

## 14.3 Build phases

1.  Foundation: schema, auth, RBAC, audit, jobs runner.
2.  Catalog and infrastructure: categories, plans, hosts, endpoints,
    Marzban adapter, health checks.
3.  Services core: allocation, provisioning, subscription, renewal,
    expiry, reconcile.
4.  Commerce: orders, payments, webhooks, refunds, fulfillment.
5.  Customer panel and admin panel (services first, then routers).
6.  Routers: Tailscale sync, router records, provisioning, replacement.
7.  Hardening: load tests, backups and restore drill, monitoring, security
    review.

------------------------------------------------------------------------

# 15. Decisions that need the owner

1.  Which payment gateway(s), and do you take manual payments
    (cash on delivery, bank or wallet transfer)?
2.  Router bundles: start the subscription at shipment (recommended), at
    first connection, or at payment?
3.  Quota: does it reset each period or accumulate? What happens at
    quota exhaustion (block, throttle, buy more)?
4.  Expiry grace and retention periods (suggested: a few days of grace,
    then a longer retention before deleting the provider user).
5.  Router replacement: always rotate credentials (recommended), or only
    when the old router is lost?
6.  Should customers see the client link for router-bound services?
    (Default in this design: no, standalone only.)
7.  Marzban topology: one panel with many nodes, or several panels?
8.  Are invoices or tax documents required?
9.  UI languages: Arabic with right-to-left layout from the start?
10. Router hardware: which models and how many to launch with?
11. Decided: cards only from 75 EGP (`min_amount_minor = 7500`), transfers
    for every amount. Still open: which gateway quotes did you get for
    wallets and InstaPay, and which gateway do you start with?
12. Provisional access: enable it or not? If yes, the caps (amount, count,
    total exposure) and the hours. Default in this design: off.
13. Receiving accounts: business accounts for InstaPay and wallet, who
    holds them, and are they allowed by the providers' terms and by tax
    rules?
14. Can the dedicated forwarder phone be kept running and monitored? If not,
    transfers are confirmed by staff and the next-day statement.

------------------------------------------------------------------------

# 16. Relation to the router project

The router side stays as in `PROJECT.md`: OpenWrt, Cowboy Bebop Manager,
sing-box and Tailscale. Needed additions on the router side:

-   The `cb-remote` wrapper and forced-command SSH key (section 10).
-   JSON output for status, version and apply results.
-   A stable way to report the applied config version.
-   The exact sing-box version policy of the manager must be known to the
    backend, so provisioning can refuse a router the manager cannot
    support.

Nothing from the business platform (customers, orders, subscriptions)
is stored on the router. The router only holds the one proxy
configuration it needs, which the customer already owns.
