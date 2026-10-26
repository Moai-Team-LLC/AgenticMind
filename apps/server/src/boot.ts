/**
 * Boot checks. Each check either logs what it verified or returns a refusal;
 * index.ts refuses to start on any refusal. Configuration values are validated
 * in every profile (an invalid value of a new setting never silently becomes
 * "no limit"); the database checks run only in the strict profile, so standard
 * deployments see no new queries at boot.
 */

import type { Profile } from "@agenticmind/shared/lib/profile"

import {
  evaluateDatabaseRole,
  readDatabaseRoleFacts,
} from "@agenticmind/shared/database/role-check"
import { resolveDatabaseTls, warnDatabaseTlsOnce } from "@agenticmind/shared/database/tls"
import { parseAnswerPolicyResult } from "@agenticmind/shared/lib/knowledge/answer-policy"
import { isStrict } from "@agenticmind/shared/lib/profile"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"
import { knowledgeFeatureSettings } from "@agenticmind/shared/settings/knowledge-feature-settings"

import { resolveActiveMcpLimits } from "@/mcp-limits"
import { getDb } from "@/server/lib/database"

/** The database login role must be subject to row-level security. */
const checkDatabaseRole = async (): Promise<string[]> => {
  const facts = await readDatabaseRoleFacts(getDb(), databaseSettings.DATABASE_APP_ROLE)
  if (facts.isErr()) {
    // Could not measure is not the same as measured-and-fine: refuse.
    return [`could not verify the database role: ${facts.error.message}`]
  }
  const reasons = evaluateDatabaseRole(facts.value)
  if (reasons.length === 0) {
    console.log(
      `[SERVER] strict: database role "${facts.value.login.name}" is subject to row-level security`,
    )
  }
  return reasons
}

/** MCP input limits must parse; logs the effective limits when any apply. */
const checkMcpLimits = (profile: Profile): string[] => {
  const limits = resolveActiveMcpLimits(profile)
  if (limits.isErr()) {
    return [limits.error]
  }
  const { maxRequestBodyBytes, maxToolInputElements } = limits.value
  if (maxRequestBodyBytes !== undefined || maxToolInputElements !== undefined) {
    console.log(
      `[SERVER] MCP limits: request body ≤ ${maxRequestBodyBytes ?? "∞"} bytes, ` +
        `tool input ≤ ${maxToolInputElements ?? "∞"} elements`,
    )
  }
  return []
}

/** Database TLS must resolve; strict additionally requires a verified certificate. */
const checkDatabaseTls = (profile: Profile): string[] => {
  const tls = resolveDatabaseTls({
    profile,
    ssl: databaseSettings.DATABASE_SSL,
    ca: databaseSettings.DATABASE_SSL_CA,
    databaseUrl: databaseSettings.DATABASE_URL,
  })
  if (tls.isErr()) {
    return [`database TLS: ${tls.error}`]
  }
  if (tls.value.warning !== undefined) {
    // Report an unverified certificate at boot, not on the first query.
    warnDatabaseTlsOnce(tls.value.warning)
  }
  if (isStrict(profile)) {
    console.log(
      `[SERVER] strict: database TLS ${tls.value.verified ? "verifies the server certificate" : "is off"}`,
    )
  }
  return []
}

/**
 * KNOWLEDGE_ANSWER_POLICY: "set but invalid" is not "not set". Strict refuses to
 * start on it; standard keeps ignoring it, as before.
 */
const checkAnswerPolicy = (profile: Profile): string[] => {
  const policy = parseAnswerPolicyResult(knowledgeFeatureSettings.KNOWLEDGE_ANSWER_POLICY)
  if (policy.isErr()) {
    return isStrict(profile) ? [`strict: KNOWLEDGE_ANSWER_POLICY is invalid — ${policy.error}`] : []
  }
  if (
    policy.value?.requireSemanticVerification !== undefined &&
    knowledgeFeatureSettings.KNOWLEDGE_FAITHFULNESS_TIER_B !== "true"
  ) {
    console.warn(
      `[SERVER] KNOWLEDGE_ANSWER_POLICY requires semantic verification but KNOWLEDGE_FAITHFULNESS_TIER_B is off — every answer will be ${policy.value.requireSemanticVerification === "block" ? "refused" : "marked needs_review"}`,
    )
  }
  return []
}

/** Runs every boot check for the profile; returns all refusals (empty = start). */
export const bootRefusals = async (profile: Profile): Promise<string[]> => {
  const refusals = [
    ...checkMcpLimits(profile),
    ...checkDatabaseTls(profile),
    ...checkAnswerPolicy(profile),
  ]
  if (refusals.length > 0) {
    // The role check opens a connection, which an invalid TLS setting forbids.
    return refusals
  }
  if (isStrict(profile)) {
    const roleRefusals = await checkDatabaseRole()
    refusals.push(...roleRefusals.map((reason) => `strict: ${reason}`))
  }
  return refusals
}
