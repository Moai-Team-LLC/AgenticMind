import { createOxlintConfig } from "@agenticmind/oxlint-config"
import { defineConfig } from "oxlint"

export default defineConfig(
  createOxlintConfig({
    rules: {
      "prefer-named-capture-group": "off",
      "typescript/method-signature-style": "off",
    },
  }),
)
