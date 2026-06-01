import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web/src"),
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    passWithNoTests: true,
  },
})
