import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        compatibilityDate: "2026-08-22",
        compatibilityFlags: ["nodejs_compat", "experimental"],
        durableObjects: { CONVERSATION: { className: "Conversation" } },
        d1Databases: ["DB"],
      },
    }),
  ],
  test: { include: ["test/workers/**/*.test.ts"] },
});
