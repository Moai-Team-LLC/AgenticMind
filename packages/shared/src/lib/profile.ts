/**
 * Deployment profile — one switch for every fail-closed hardening.
 *
 * - `standard` (default): today's behaviour, unchanged for existing consumers.
 * - `strict`: the hardened profile. Checks that standard only reports (or does
 *   not run) become refusals: the server will not start on a superuser database
 *   role, an unverified TLS certificate, or a malformed answer policy, and the
 *   acceptance gate stops failing open.
 *
 * Selected by AGENTICMIND_PROFILE and resolved once at boot. An unknown value is
 * an error, never a silent fallback to `standard`: a typo in the switch that is
 * supposed to harden a deployment must not quietly un-harden it.
 */

import type { Result } from "neverthrow"

import { profileSettings } from "@agenticmind/shared/settings/profile-settings"
import { err, ok } from "neverthrow"

export const PROFILES = ["standard", "strict"] as const
export type Profile = (typeof PROFILES)[number]

export const DEFAULT_PROFILE: Profile = "standard"

export type ProfileError = { readonly type: "invalid_profile"; readonly message: string }

const isProfile = (value: string): value is Profile =>
  (PROFILES as readonly string[]).includes(value)

/** Parses the raw AGENTICMIND_PROFILE value. Unset / blank ⇒ `standard`. */
export const parseProfile = (raw: string | undefined | null): Result<Profile, ProfileError> => {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return ok(DEFAULT_PROFILE)
  }
  const value = raw.trim()
  if (isProfile(value)) {
    return ok(value)
  }
  return err({
    type: "invalid_profile",
    message: `AGENTICMIND_PROFILE=${JSON.stringify(raw)} is not one of: ${PROFILES.join(", ")}`,
  })
}

export const isStrict = (profile: Profile): boolean => profile === "strict"

/** The deployment's profile from AGENTICMIND_PROFILE. Entry points call this at
 * boot and refuse to start on an error. */
export const resolveActiveProfile = (): Result<Profile, ProfileError> =>
  parseProfile(profileSettings.AGENTICMIND_PROFILE)

/**
 * The active profile for library code (database client, ingest gates). Throws on
 * an invalid value — by the time library code runs, the entry point has already
 * refused to start on it, so reaching the throw means an entry point skipped
 * its boot check.
 */
export const activeProfile = (): Profile => {
  const resolved = resolveActiveProfile()
  if (resolved.isErr()) {
    throw new Error(resolved.error.message)
  }
  return resolved.value
}
