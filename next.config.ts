import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // Standalone output for minimal Docker runner image.
  // The existing VM 102 systemd deploy (next start) is unaffected —
  // standalone mode still produces .next/server and next start works.
  output: "standalone",

  // Include the WDK world-postgres package in the standalone output trace.
  // Next.js static analysis can't detect dynamic require('@workflow/world-postgres')
  // that the WDK runtime resolves based on WORKFLOW_TARGET_WORLD at startup.
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/@workflow/world-postgres/**",
      "./node_modules/.pnpm/@workflow+world-postgres*/**",
    ],
  },

  typescript: {
    // The .next/types/validator.ts Turbopack race condition causes false positives.
    // Type safety is enforced via ./node_modules/.bin/tsc --noEmit separately.
    ignoreBuildErrors: true,
  },
  // Prevent Turbopack from bundling native Node modules into the WDK workflow bundle.
  // These packages are only used in step functions (server-side), not in workflow orchestration.
  serverExternalPackages: [
    "@slack/web-api",
    "@anthropic-ai/claude-agent-sdk",
    "@anthropic-ai/sdk",
    "postgres",
    "drizzle-orm",
  ],
};

export default withWorkflow(nextConfig);
