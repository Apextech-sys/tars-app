# syntax=docker/dockerfile:1
# =============================================================================
# TARS App — multi-stage production image (Iteration 1)
# Node 24 slim (Debian, glibc) — Alpine avoided due to musl incompatibility
# with native binaries in the dependency tree.
# Uses Next.js standalone output for minimal runner layer.
#
# Startup: entrypoint runs drizzle migrations against DATABASE_URL before
# starting the Next.js server — this is the migration gate for the Dokploy
# deployment (no VERCEL_ENV dependency, no separate init container needed).
# =============================================================================

ARG NODE_VERSION=24

# ── base: node + pnpm ──────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate 2>/dev/null || npm install -g pnpm@latest
WORKDIR /app

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY package.json ./
COPY tars-worker/package.json ./tars-worker/
RUN pnpm install --frozen-lockfile --ignore-scripts

# ── builder ───────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# Stub env vars so the WDK world-postgres module can initialize at build time
# without a real postgres connection. The actual secrets come from Dokploy at
# runtime — these stubs are ONLY needed so `next build` (page-data collection)
# doesn't crash when it module-imports routes that reference postgres env vars.
ENV DATABASE_URL="postgres://tars_app:buildstub@localhost:5432/tars_app"
ENV WORKFLOW_TARGET_WORLD="@workflow/world-postgres"
ENV WORKFLOW_POSTGRES_URL="postgres://tars_app:buildstub@localhost:5432/tars_app"
ENV WORKFLOW_POSTGRES_JOB_PREFIX="tars"
ENV BETTER_AUTH_SECRET="buildstub_32chars_replace_in_runtime"
ENV BETTER_AUTH_URL="http://localhost:3001"
ENV TARS_WORKER_CALLBACK_SECRET="buildstub_64chars_replace_in_runtime_env"
ENV NEXT_PUBLIC_APP_URL="http://localhost:3001"

# discover-plugins is a pure FS scan; VERCEL_ENV unset so migrate-prod.ts is a no-op.
RUN pnpm discover-plugins && pnpm next build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 nodejs && \
    useradd  --system --uid 1001 --gid nodejs nextjs && \
    # pg client (used by migration runner) needs no extra packages —
    # node:slim has enough for the pg pure-JS driver
    true

WORKDIR /app

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone   ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static       ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public             ./public
COPY --from=builder --chown=nextjs:nodejs /app/drizzle            ./drizzle

# @workflow/world-postgres and @workflow/world are not traced by the Next.js
# standalone bundler (they are loaded dynamically at route-request time by the
# WDK runtime). Install them explicitly in the runner stage via npm so that
# peer dependencies (zod etc.) are resolved correctly without pnpm symlinks.
# RUN as root before switching to nextjs user.

# Migration runner: standalone ESM script using the pg package already present
# in the standalone output's node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrate-standalone.mjs ./migrate.js

# Entrypoint: run migrations then start Next.js
COPY --from=builder --chown=nextjs:nodejs /app/docker/migrate-and-start.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Install @workflow/world-postgres + its runtime deps so the WDK can load
# them at runtime. --ignore-scripts avoids running gyp/native build scripts
# that aren't available in slim. These packages are pure-JS.
RUN npm install --prefix /app --no-save --ignore-scripts     "@workflow/world@4.1.2"     "@workflow/world-postgres@4.1.2"     "@workflow/utils@4.1.2"     "@workflow/errors@4.1.2"   && chown -R nextjs:nodejs /app/node_modules

USER nextjs

EXPOSE 3001
ENV PORT=3001
ENV HOST=0.0.0.0

HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
    CMD node -e "require('http').get('http://localhost:'+process.env.PORT+'/api/health', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["/bin/sh", "/app/entrypoint.sh"]
