#!/bin/sh
# Dokploy entrypoint: run drizzle migrations + WDK setup then start Next.js.
# DATABASE_URL and WORKFLOW_POSTGRES_URL must be set in the Dokploy env.
set -e

echo "[entrypoint] running drizzle migrations..."
node /app/migrate.js

echo "[entrypoint] running WDK database setup (idempotent)..."
node /app/node_modules/.pnpm/@workflow+world-postgres@4.1.2_@opentelemetry+api@1.9.0_@types+pg@8.20.0_kysely@0.28.17_postgres@3.4.9_typescript@5.9.3/node_modules/@workflow/world-postgres/bin/setup.js

echo "[entrypoint] starting Next.js server..."
exec /app/node_modules/.bin/next start --port "${PORT:-3001}" --hostname "0.0.0.0"
