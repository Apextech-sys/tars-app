# syntax=docker/dockerfile:1
# =============================================================================
# TARS App — multi-stage production image (Iteration 3a)
# Node 24 slim (Debian, glibc)
#
# Why non-standalone: the WDK (@workflow/world-postgres) resolves runtime deps
# via dynamic ESM import at route request time. The Next.js standalone tracer
# cannot follow pnpm's virtual-store symlinks to collect all transitive deps.
# Running `next start` with production node_modules (same as VM-102 systemd)
# is the correct approach.
#
# Build strategy:
#   1. deps-dev  — full dev install (needed for `next build`)
#   2. deps-prod — production-only install (no devDeps, for the runner)
#   3. builder   — runs next build on top of dev deps
#   4. runner    — copies the .next output + prod node_modules
#
# Startup: entrypoint runs drizzle migrations before starting Next.js.
# =============================================================================

ARG NODE_VERSION=24

# ── base: node + pnpm ──────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate 2>/dev/null || npm install -g pnpm@latest
WORKDIR /app

# ── deps-dev: full install for build ──────────────────────────────────────────
FROM base AS deps-dev
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY package.json ./
COPY tars-worker/package.json ./tars-worker/
RUN pnpm install --frozen-lockfile --ignore-scripts

# ── deps-prod: production-only install for runner ─────────────────────────────
FROM base AS deps-prod
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY package.json ./
COPY tars-worker/package.json ./tars-worker/
# CI=true suppresses the interactive confirmation prompt for purging dev modules
RUN CI=true pnpm install --frozen-lockfile --prod --ignore-scripts

# ── builder ───────────────────────────────────────────────────────────────────
FROM deps-dev AS builder
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgres://tars_app:buildstub@localhost:5432/tars_app"
ENV WORKFLOW_TARGET_WORLD="@workflow/world-postgres"
ENV WORKFLOW_POSTGRES_URL="postgres://tars_app:buildstub@localhost:5432/tars_app"
ENV WORKFLOW_POSTGRES_JOB_PREFIX="tars"
ENV BETTER_AUTH_SECRET="buildstub_32chars_replace_in_runtime"
ENV BETTER_AUTH_URL="http://localhost:3001"
ENV TARS_WORKER_CALLBACK_SECRET="buildstub_64chars_replace_in_runtime_env"
ENV NEXT_PUBLIC_APP_URL="http://localhost:3001"

RUN pnpm discover-plugins && pnpm next build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@latest --activate 2>/dev/null || npm install -g pnpm@latest && \
    groupadd --system --gid 1001 nodejs && \
    useradd  --system --uid 1001 --gid nodejs nextjs

WORKDIR /app

# Production node_modules (pnpm virtual store — preserves symlinks)
COPY --from=deps-prod --chown=nextjs:nodejs /app/node_modules         ./node_modules
COPY --from=deps-prod --chown=nextjs:nodejs /app/tars-worker/node_modules ./tars-worker/node_modules

# App files
COPY --from=builder --chown=nextjs:nodejs /app/package.json         ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-workspace.yaml  ./pnpm-workspace.yaml
COPY --from=builder --chown=nextjs:nodejs /app/.next                ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public               ./public
COPY --from=builder --chown=nextjs:nodejs /app/drizzle              ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/lib                  ./lib
COPY --from=builder --chown=nextjs:nodejs /app/workflows            ./workflows

# Migration runner + entrypoint
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrate-standalone.mjs ./migrate.js
COPY --from=builder --chown=nextjs:nodejs /app/docker/migrate-and-start.sh    ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs

EXPOSE 3001
ENV PORT=3001
ENV HOST=0.0.0.0

HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
    CMD node -e "require('http').get('http://localhost:'+process.env.PORT+'/api/health', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["/bin/sh", "/app/entrypoint.sh"]
