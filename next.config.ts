import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // Standalone output for minimal Docker runner image.
  output: "standalone",

  // Include the WDK runtime packages in the standalone output trace.
  // Next.js static analysis cannot detect dynamic require('@workflow/world-postgres')
  // that the WDK runtime resolves based on WORKFLOW_TARGET_WORLD at startup.
  // We include the full pnpm virtual-store directories for all @workflow packages
  // and their runtime dependencies so the standalone output contains everything
  // needed to initialise the WDK postgres world at route request time.
  outputFileTracingIncludes: {
    "/**": [
      // @workflow packages (all variants in pnpm store)
      "./node_modules/@workflow/**",
      "./node_modules/.pnpm/@workflow+*/**",
      // drizzle-orm/node-postgres (world-postgres uses this subpath)
      "./node_modules/.pnpm/drizzle-orm*/**",
      "./node_modules/drizzle-orm/**",
      // pg (node-postgres driver)
      "./node_modules/.pnpm/pg@*/**",
      "./node_modules/pg/**",
      // graphile-worker (used by world-postgres for the job queue)
      "./node_modules/.pnpm/graphile*/**",
      "./node_modules/.pnpm/@graphile*/**",
      // cbor-x (used by @vercel/queue inside world-postgres)
      "./node_modules/.pnpm/cbor-x*/**",
      // @vercel/queue
      "./node_modules/.pnpm/@vercel+queue*/**",
      // zod (peer dep of @workflow/world)
      "./node_modules/.pnpm/zod@4.3.6*/**",
      // ulid (dep of @workflow/world)
      "./node_modules/.pnpm/ulid*/**",
    ],
  },

  typescript: {
    ignoreBuildErrors: true,
  },

  serverExternalPackages: [
    "@slack/web-api",
    "@anthropic-ai/claude-agent-sdk",
    "@anthropic-ai/sdk",
    "postgres",
    "drizzle-orm",
    // WDK world packages — load from node_modules at runtime, not bundled
    "@workflow/world",
    "@workflow/world-postgres",
    "@workflow/world-local",
    "@workflow/utils",
    "@workflow/errors",
    "workflow",
    "graphile-worker",
    "pg",
    "cbor-x",
  ],
};

export default withWorkflow(nextConfig);
