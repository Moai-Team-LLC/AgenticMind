// oxlint-disable node/no-process-env
// We need to access process.env directly so we don't have to import the settings module from the shared package.

import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: ["./packages/shared/src/database/schema/**/*.ts"],
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
