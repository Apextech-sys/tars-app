#!/bin/sh
# Dokploy entrypoint: run drizzle migrations then start Next.js server.
# DATABASE_URL must be set in the Dokploy env.
set -e

echo "[entrypoint] running drizzle migrations..."
node /app/migrate.js
echo "[entrypoint] migrations done, starting server..."

# Unset HOSTNAME so Next.js standalone server.js falls back to 0.0.0.0.
# Without this, Docker Swarm sets HOSTNAME=<container_id> and Next.js binds
# only to that hostname, causing health checks on localhost:PORT to fail.
unset HOSTNAME
exec node /app/server.js
