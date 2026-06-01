# syntax=docker/dockerfile:1
# =============================================================================
# TARS App — multi-stage production image (Iteration 3a)
# Node 24 slim (Debian, glibc) — Alpine avoided due to musl incompatibility.
# Uses Next.js standalone output for minimal runner layer.
#
# The WDK (@workflow/world-postgres) and its dep tree are included via
# outputFileTracingIncludes in next.config.ts and serverExternalPackages,
# so the standalone output contains all packages needed at runtime.
#
# Startup: entrypoint runs drizzle migrations before starting Next.js.
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

RUN groupadd --system --gid 1001 nodejs && \
    useradd  --system --uid 1001 --gid nodejs nextjs

WORKDIR /app

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone   ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static       ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public             ./public
COPY --from=builder --chown=nextjs:nodejs /app/drizzle            ./drizzle

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
