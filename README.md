# CowboyBepob Site

Initial application foundation for the proxy/router management platform described in the project architecture.

## Stack
- React + TypeScript + Vite for the web app
- Fastify + TypeScript for the API
- PostgreSQL for persistence
- Docker Compose for local development

## Quick start
Requirements: Node.js 20+ and Docker Compose.

```bash
npm install
npm run dev
```

For the full local stack:

```bash
docker compose up --build
```

Web UI: http://localhost:5173  
API health: http://localhost:4000/health

The first cut establishes the app structure and admin/customer navigation. Any demo records are explicitly marked as sample data; production use requires persistent repositories, authentication/RBAC, migrations, and provider integrations.
