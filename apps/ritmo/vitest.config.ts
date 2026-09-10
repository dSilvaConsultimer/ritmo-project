import { defineConfig } from "vitest/config";
import path from "node:path";

// Deliberately separate from vite.config.ts (which loads the full
// TanStack Start/Lovable dev-server plugin chain) — adapter/format unit
// tests are plain Node functions and don't need any of that.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
