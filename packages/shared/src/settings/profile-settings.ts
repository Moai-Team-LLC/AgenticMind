// oxlint-disable node/no-process-env
// Settings modules are the only place in this repository where direct process.env access is allowed.

import { createEnv } from "@t3-oss/env-core"
import * as z from "zod"

/**
 * Deployment profile switch (AGENTICMIND_PROFILE).
 *
 * Kept as a raw string here on purpose: under SKIP_VALIDATION the Zod transform
 * is bypassed, so the value is parsed (and an unknown value rejected) by
 * `parseProfile` in lib/profile.ts — the single place that decides the profile.
 * An empty value (`AGENTICMIND_PROFILE=` in an env file) means "unset".
 */
export const profileSettings = createEnv({
  server: {
    AGENTICMIND_PROFILE: z.string().optional(),
  },
  runtimeEnv: {
    AGENTICMIND_PROFILE: process.env.AGENTICMIND_PROFILE,
  },
  emptyStringAsUndefined: true,
  isServer: typeof window === "undefined",
  skipValidation: process.env.SKIP_VALIDATION?.toLowerCase() === "true",
})
