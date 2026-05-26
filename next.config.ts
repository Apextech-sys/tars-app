import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
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
