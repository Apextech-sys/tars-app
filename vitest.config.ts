import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "workflows/__tests__/**/*.test.ts",
      "lib/tars/__tests__/**/*.test.ts",
      "lib/notifications/__tests__/**/*.test.ts",
      "app/**/__tests__/**/*.test.ts",
    ],
    environment: "node",
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@/workflows": new URL("./workflows", import.meta.url).pathname,
      "@": new URL(".", import.meta.url).pathname,
    },
  },
});
