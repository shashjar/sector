import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolves the "@/*" alias from tsconfig.json natively — no plugin needed.
  resolve: { tsconfigPaths: true },
  test: {
    // Computation and API routes use Node APIs. No DOM, so no jsdom.
    environment: "node",
    include: ["{app,lib,components}/**/*.test.ts"],
  },
});
