import Fastify from "fastify";
import cors from "@fastify/cors";
import pg from "pg";

const { Pool } = pg;
const app = Fastify({ logger: true });
const port = Number(process.env.PORT || 4000);
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

await app.register(cors, { origin: process.env.CORS_ORIGIN?.split(",") ?? ["http://localhost:5173"] });

app.get("/health", async (_request, reply) => {
  let database: "connected" | "not_configured" | "unavailable" = "not_configured";
  if (pool) {
    try { await pool.query("SELECT 1"); database = "connected"; }
    catch { database = "unavailable"; }
  }
  return reply.code(database === "unavailable" ? 503 : 200).send({ status: database === "unavailable" ? "degraded" : "ok", service: "api", database });
});

const sample = {
  dashboard: {
    metrics: [
      { key: "customers", label: "إجمالي العملاء", value: 1284 },
      { key: "active_services", label: "الخدمات النشطة", value: 2916 },
      { key: "routers_online", label: "الراوترات المتصلة", value: 86, total: 92 },
      { key: "monthly_revenue", label: "إيرادات الشهر", value: 48250, currency: "EGP" }
    ],
    sampleData: true
  },
  customers: [
    { id: "C-1028", name: "أحمد محمد", email: "ahmed@example.com", status: "active" },
    { id: "C-1027", name: "محمود علي", email: "mahmoud@example.com", status: "active" },
    { id: "C-1026", name: "سارة حسن", email: "sara@example.com", status: "suspended" }
  ],
  services: [
    { id: "SVC-2104", name: "باقة منزلية", protocol: "VLESS", status: "active" },
    { id: "SVC-2103", name: "باقة أعمال", protocol: "VMess", status: "active" }
  ],
  routers: [
    { id: "RTR-011", name: "راوتر المكتب", platform: "OpenWrt", status: "online", address: "10.0.0.1" },
    { id: "RTR-009", name: "فرع دمياط", platform: "OpenWrt", status: "offline", address: "10.0.0.3" }
  ]
};

app.get("/api/v1/admin/dashboard", async () => sample.dashboard);
app.get("/api/v1/admin/customers", async () => ({ items: sample.customers, sampleData: true }));
app.get("/api/v1/admin/services", async () => ({ items: sample.services, sampleData: true }));
app.get("/api/v1/admin/routers", async () => ({ items: sample.routers, sampleData: true }));
app.get("/api/v1/customer/services", async () => ({ items: sample.services.filter(item => item.status === "active"), sampleData: true }));
app.get("/api/v1/customer/routers", async () => ({ items: sample.routers, sampleData: true }));

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  return reply.code(500).send({ error: "internal_server_error", message: "حدث خطأ داخلي." });
});

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

process.on("SIGTERM", async () => {
  await app.close();
  await pool?.end();
});
