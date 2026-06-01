#!/bin/sh
# Dokploy entrypoint: run drizzle migrations then start Next.js server.
# DATABASE_URL must be set in the Dokploy env.
set -e

echo "[entrypoint] running drizzle migrations..."
node /app/migrate.js
echo "[entrypoint] migrations done, starting server..."

# Use next's CLI via exec (OS runs via the shebang, not via `node <script>`)
exec /app/node_modules/.bin/next start --port "${PORT:-3001}" --hostname "0.0.0.0"
