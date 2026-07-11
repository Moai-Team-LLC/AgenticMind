/**
 * Compiled-skill repository (§4). Upsert a skill by (tenant, target), upsert a version by
 * (skill, corpus snapshot) so recompiling identical corpus is idempotent, and read the
 * latest version for a target. Follows the query-function convention: `{ tx }` props,
 * neverthrow ResultAsync, mapDatabaseError. Tenant is auto-stamped + RLS-enforced by the DB.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { SkillVersionSelect } from "@agenticmind/shared/database/schema"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import { skills, skillVersions } from "@agenticmind/shared/database/schema"
import { desc, eq } from "drizzle-orm"
import { ResultAsync } from "neverthrow"

/** Insert the skill for `target`, or return the existing one (name refreshed). Returns its id. */
export const upsertSkill = (props: { tx: Transaction; target: string; name: string }) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .insert(skills)
        .values({ target: props.target, name: props.name })
        .onConflictDoUpdate({
          target: [skills.tenantId, skills.target],
          set: { name: props.name },
        })
        .returning({ id: skills.id })
      if (row === undefined) {
        throw new Error("upsertSkill returned no row")
      }
      return row.id
    })(),
    mapDatabaseError,
  )

export type InsertSkillVersionInput = {
  skillId: string
  version: string
  corpusSnapshotId: string
  extractorModel: string
  extractorVersion: string
  judgeModel: string
  judgeVersionHash: string
  evalPassRate: number
  passed: boolean
  md: string
  citations: unknown
  contradicted: unknown
  completenessScore?: number | null
  missed?: unknown
  gitSha?: string | null
  compiledAt: Date
}

/** Upsert a compiled version by (skillId, corpusSnapshotId) — an identical recompile
 * overwrites in place rather than piling up rows. Returns its id. */
export const insertSkillVersion = (props: { tx: Transaction; input: InsertSkillVersionInput }) =>
  ResultAsync.fromPromise(
    (async () => {
      const v = props.input
      const [row] = await props.tx
        .insert(skillVersions)
        .values({
          skillId: v.skillId,
          version: v.version,
          corpusSnapshotId: v.corpusSnapshotId,
          extractorModel: v.extractorModel,
          extractorVersion: v.extractorVersion,
          judgeModel: v.judgeModel,
          judgeVersionHash: v.judgeVersionHash,
          evalPassRate: v.evalPassRate,
          passed: v.passed,
          md: v.md,
          citations: v.citations,
          contradicted: v.contradicted,
          completenessScore: v.completenessScore ?? null,
          missed: v.missed ?? [],
          gitSha: v.gitSha ?? null,
          compiledAt: v.compiledAt,
        })
        .onConflictDoUpdate({
          target: [skillVersions.skillId, skillVersions.corpusSnapshotId],
          set: {
            version: v.version,
            extractorModel: v.extractorModel,
            extractorVersion: v.extractorVersion,
            judgeModel: v.judgeModel,
            judgeVersionHash: v.judgeVersionHash,
            evalPassRate: v.evalPassRate,
            passed: v.passed,
            md: v.md,
            citations: v.citations,
            contradicted: v.contradicted,
            completenessScore: v.completenessScore ?? null,
            missed: v.missed ?? [],
            compiledAt: v.compiledAt,
          },
        })
        .returning({ id: skillVersions.id })
      if (row === undefined) {
        throw new Error("insertSkillVersion returned no row")
      }
      return row.id
    })(),
    mapDatabaseError,
  )

/** Most-recently compiled version for a target (null when the skill has never compiled). */
export const getLatestSkillVersion = (props: {
  tx: Transaction
  target: string
}): ResultAsync<SkillVersionSelect | null, ReturnType<typeof mapDatabaseError>> =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .select()
        .from(skillVersions)
        .innerJoin(skills, eq(skillVersions.skillId, skills.id))
        .where(eq(skills.target, props.target))
        .orderBy(desc(skillVersions.createdAt))
        .limit(1)
      return row?.skill_versions ?? null
    })(),
    mapDatabaseError,
  )
