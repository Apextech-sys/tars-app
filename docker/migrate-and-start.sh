#!/bin/sh
# Dokploy entrypoint: run drizzle migrations then start Next.js server.
# DATABASE_URL must be set in the Dokploy env.
set -e

echo "[entrypoint] running drizzle migrations..."
node /app/migrate.js
echo "[entrypoint] migrations done, starting server..."
exec node /app/server.js
