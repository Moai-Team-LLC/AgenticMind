import { tenantColumn } from "@agenticmind/shared/database/schema/knowledge/_tenant"
import { sql } from "drizzle-orm"
import {
  boolean,
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

/**
 * Compiled skills (Verified-Autonomy doctrine §4). A `skill` is one behaviour the corpus
 * can teach ("deploy-strands-safely"); each `skill_version` is one fail-closed compilation
 * of it — the rendered SKILL.md plus the full provenance (corpus snapshot, extractor +
 * decorrelated judge identities, L2 faithfulness pass rate). Persisting the artifact makes
 * a skill queryable/versioned; git landing (`git_sha`) stays an out-of-band operator step.
 *
 * Tenant-scoped like the rest of the knowledge layer: `tenant_id` auto-stamps from the
 * `app.current_tenant` GUC and RLS (added in the same migration) enforces isolation below
 * the app — a compiled skill never leaks across tenants.
 */
const skills = pgTable(
  "skills",
  {
    ...tenantColumn,
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** The behaviour this skill encodes, e.g. "deploy-strands-safely". */
    target: text("target").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [uniqueIndex("skills_tenant_target_uidx").on(table.tenantId, table.target)],
)

const skillVersions = pgTable(
  "skill_versions",
  {
    ...tenantColumn,
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    /** Semver, bumped per recompile. */
    version: text("version").notNull(),
    /** Deterministic content hash of the corpus slice — reproducible recompiles. */
    corpusSnapshotId: text("corpus_snapshot_id").notNull(),
    extractorModel: text("extractor_model").notNull(),
    extractorVersion: text("extractor_version").notNull(),
    /** The decorrelated L2 judge (a different family than the extractor, §1a). */
    judgeModel: text("judge_model").notNull(),
    judgeVersionHash: text("judge_version_hash").notNull(),
    /** L2 faithfulness pass rate (entailed / judged directives). */
    evalPassRate: real("eval_pass_rate").notNull(),
    /** Whether the L2 gate passed at compile time. */
    passed: boolean("passed").notNull(),
    /** The rendered, machine-facing SKILL.md. */
    md: text("md").notNull(),
    /** SkillCitation[] backing the directives. */
    citations: jsonb("citations")
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Directives whose cited snippet did not support them (empty when passed strictly). */
    contradicted: jsonb("contradicted")
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Git sha, once the SKILL.md is landed by an operator/CI step (nullable). */
    gitSha: text("git_sha"),
    compiledAt: timestamp("compiled_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    // Recompiling the SAME corpus slice for a skill is idempotent (upsert target).
    uniqueIndex("skill_versions_skill_snapshot_uidx").on(table.skillId, table.corpusSnapshotId),
    index("skill_versions_skill_created_idx").on(table.skillId, table.createdAt.desc()),
  ],
)

type SkillInsert = typeof skills.$inferInsert
type SkillSelect = typeof skills.$inferSelect
type SkillVersionInsert = typeof skillVersions.$inferInsert
type SkillVersionSelect = typeof skillVersions.$inferSelect

export {
  skills,
  skillVersions,
  type SkillInsert,
  type SkillSelect,
  type SkillVersionInsert,
  type SkillVersionSelect,
}
