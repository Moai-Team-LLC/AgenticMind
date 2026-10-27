/**
 * Eval harness — the Standard's three-level pyramid, Level 1 (code assertions)
 * + the runner that drives any level. Cases are organised by FAILURE MODE
 * (not generic "quality"); the eval set grows from production failures.
 *
 * The runner is dependency-injected: pass an `ask` fn that runs the real engine
 * (guard + retrieve + synth) OR a stub for unit tests. Level 2 (LLM-as-judge,
 * binary) plugs in via the optional `judge` dep. CI blocks on regression vs a
 * baseline pass rate.
 */

import type { AnswerPolicy } from "@agenticmind/shared/lib/knowledge/answer-policy"
import type { Result } from "neverthrow"

import { answerPolicySchema } from "@agenticmind/shared/lib/knowledge/answer-policy"
import { findPii } from "@agenticmind/shared/lib/knowledge/guard"
import { err, ok } from "neverthrow"

/** Level-1 code assertions for one case. All optional; only set ones are checked. */
export type EvalAssertions = {
  /** The input guard should reject this (injection / abuse cases). */
  expectBlocked?: boolean
  minCitations?: number
  maxCitations?: number
  /** Material titles (case-insensitive substring) that MUST appear among citations. */
  mustCiteMaterial?: string[]
  /** Gold set of relevant material titles (case-insensitive substring) — the basis
   * for citation precision/recall on this case. */
  relevantMaterials?: string[]
  /** Min citation precision (cited∩relevant / cited) the answer must reach (0..1). */
  minCitationPrecision?: number
  /** Min citation recall (cited∩relevant / relevant) the answer must reach (0..1). */
  minCitationRecall?: number
  /** Phrases the answer MUST contain (case-insensitive). */
  mustMention?: string[]
  /** Phrases the answer MUST NOT contain (e.g. leaked system prompt, fabrications). */
  forbidPhrases?: string[]
  minAnswerChars?: number
  /** Min Tier-A faithfulness groundedness (0..1) the answer must reach. */
  minGroundedness?: number
  /** Max groundedness (for cases that should be ungrounded). */
  maxGroundedness?: number
  /** The engine should abstain (decline) on this query. */
  expectAbstain?: boolean
  /** The answer's derived status must equal one of these. */
  expectStatus?: string[]
  /** The answer must (true) / must not (false) surface contested sources. */
  expectContested?: boolean
  /** The answer must (true) / must not (false) rest only on stale sources. */
  expectStaleSourcesOnly?: boolean
  /** The answer must contain NO detectable PII (email/phone/card/SSN/IPv4). */
  expectNoPii?: boolean
  /** The answer must NOT have been served from the answer cache (false-hit guard). */
  expectNotCached?: boolean
  /** Optional Level-2 binary judge question; requires a `judge` dep. */
  judge?: string
}

export type EvalCase = {
  id: string
  /** The named failure bucket this case guards against. */
  failureMode: string
  query: string
  /** Answer policy (KNOWLEDGE_ANSWER_POLICY semantics) the engine runs this case
   * under — for cases that measure the opt-in refusal path. Absent = no policy, the
   * default deployment, whose posture is to surface weakness, not refuse. */
  answerPolicy?: AnswerPolicy
  assertions: EvalAssertions
}

/** What the engine produced for a query (or that the guard blocked it). */
export type EvalObservation = {
  blocked: boolean
  answer: string
  citations: { title: string; materialId: string }[]
  /** Tier-A faithfulness groundedness (0..1); defaults to 1 when the engine omits it. */
  groundedness?: number
  /** Whether the engine declined to answer. */
  abstained?: boolean
  /** Derived trust verdict (supported | partial | unsupported | conflicted | needs_review). */
  status?: string
  /** Count of contested facts the answer surfaced (sources disagree). */
  contestedCount?: number
  /** Whether the answer rests only on non-active (stale) sources. */
  staleSourcesOnly?: boolean
  /** Which path served the answer (cache | card_synth | synth). */
  servedBy?: string
}

/** Per-case engine options an AskForEval must apply (they are part of the case). */
export type AskOptionsForEval = { answerPolicy?: AnswerPolicy }
export type AskForEval = (query: string, opts?: AskOptionsForEval) => Promise<EvalObservation>
export type JudgeForEval = (question: string, observation: EvalObservation) => Promise<boolean>

export type CaseResult = {
  id: string
  failureMode: string
  passed: boolean
  failures: string[]
  /** Citation precision/recall, present only when the case declared relevantMaterials. */
  precision?: number
  recall?: number
  /** What the engine answered, on a failed case only — one line, at most
   * ANSWER_EXCERPT_CHARS — so a brittle assertion can be told from a wrong answer
   * without re-running the (paid) case. */
  answerExcerpt?: string
}

/** Cap on CaseResult.answerExcerpt, in user-perceived characters (grapheme clusters). */
export const ANSWER_EXCERPT_CHARS = 200

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

const answerExcerpt = (obs: EvalObservation): string => {
  if (obs.blocked) {
    return "(blocked by the input guard)"
  }
  const oneLine = obs.answer.replaceAll(/\s+/gu, " ").trim()
  if (oneLine === "") {
    return "(empty answer)"
  }
  const chars = Array.from(graphemes.segment(oneLine), (g) => g.segment)
  return chars.length <= ANSWER_EXCERPT_CHARS
    ? oneLine
    : `${chars.slice(0, ANSWER_EXCERPT_CHARS - 1).join("")}…`
}

/** The excerpt field for a case result — present only when the case failed. */
const failedAnswer = (failures: readonly string[], obs: EvalObservation) =>
  failures.length > 0 ? { answerExcerpt: answerExcerpt(obs) } : {}

export type EvalReport = {
  total: number
  passed: number
  passRate: number
  byFailureMode: Record<string, { total: number; passed: number; passRate: number }>
  results: CaseResult[]
  /** Mean citation precision/recall over the cases that declared relevantMaterials
   * (undefined when no case did). */
  citationPrecision?: number
  citationRecall?: number
}

const includesCi = (haystack: string, needle: string): boolean =>
  haystack.toLowerCase().includes(needle.toLowerCase())

/**
 * Citation precision/recall against a gold set, by case-insensitive substring
 * (consistent with mustCiteMaterial). A cited title counts as a hit if it matches
 * any relevant title. precision = hits / cited (1 when nothing was cited — no
 * false positives); recall = matched-relevant / relevant (1 when no gold given).
 */
export const citationMetrics = (
  citedTitles: readonly string[],
  relevantTitles: readonly string[],
): { precision: number; recall: number } => {
  const round3 = (v: number): number => Math.round(v * 1000) / 1000
  const citedHits = citedTitles.filter((c) => relevantTitles.some((r) => includesCi(c, r)))
  const relevantHit = relevantTitles.filter((r) => citedTitles.some((c) => includesCi(c, r)))
  const precision = citedTitles.length === 0 ? 1 : round3(citedHits.length / citedTitles.length)
  const recall =
    relevantTitles.length === 0 ? 1 : round3(relevantHit.length / relevantTitles.length)
  return { precision, recall }
}

/** Tier-A faithfulness Level-1 checks: groundedness floor/ceiling + abstention. Pure. */
const faithfulnessFailures = (a: EvalAssertions, obs: EvalObservation): string[] => {
  const failures: string[] = []
  const grounded = obs.groundedness ?? 1
  if (a.minGroundedness !== undefined && grounded < a.minGroundedness) {
    failures.push(`groundedness ${grounded.toFixed(2)} < ${a.minGroundedness}`)
  }
  if (a.maxGroundedness !== undefined && grounded > a.maxGroundedness) {
    failures.push(`groundedness ${grounded.toFixed(2)} > ${a.maxGroundedness}`)
  }
  if (a.expectAbstain === true && obs.abstained !== true) {
    failures.push("expected the engine to abstain")
  }
  if (a.expectAbstain === false && obs.abstained === true) {
    failures.push("engine unexpectedly abstained")
  }
  return failures
}

/** Trust-signal Level-1 checks: derived status, contested, stale-sources-only. Pure. */
const trustSignalFailures = (a: EvalAssertions, obs: EvalObservation): string[] => {
  const failures: string[] = []
  if (a.expectStatus !== undefined && !a.expectStatus.includes(obs.status ?? "")) {
    failures.push(`status ${obs.status ?? "(none)"} not in [${a.expectStatus.join(", ")}]`)
  }
  if (a.expectContested !== undefined && (obs.contestedCount ?? 0) > 0 !== a.expectContested) {
    failures.push(`expected contested=${a.expectContested}, got ${(obs.contestedCount ?? 0) > 0}`)
  }
  if (
    a.expectStaleSourcesOnly !== undefined &&
    (obs.staleSourcesOnly ?? false) !== a.expectStaleSourcesOnly
  ) {
    failures.push(`expected staleSourcesOnly=${a.expectStaleSourcesOnly}`)
  }
  if (a.expectNoPii === true) {
    const leaked = findPii(obs.answer)
    if (leaked.length > 0) {
      failures.push(`answer leaked PII: ${leaked.map((p) => p.kind).join(", ")}`)
    }
  }
  if (a.expectNotCached === true && obs.servedBy === "cache") {
    failures.push("answer was served from cache (possible false-hit for a different question)")
  }
  return failures
}

/** Applies Level-1 assertions (+ optional judge) to one observation. Pure. */
export const evaluateCase = async (
  c: EvalCase,
  obs: EvalObservation,
  judge?: JudgeForEval,
): Promise<CaseResult> => {
  const a = c.assertions
  const failures: string[] = []
  let metrics: { precision: number; recall: number } | undefined

  if (a.expectBlocked === true && !obs.blocked) {
    failures.push("expected the input to be blocked")
  }
  if (a.expectBlocked !== true && obs.blocked) {
    failures.push("input was unexpectedly blocked")
  }

  // Once blocked, answer-level assertions don't apply.
  if (!obs.blocked) {
    const nCit = obs.citations.length
    if (a.minCitations !== undefined && nCit < a.minCitations) {
      failures.push(`expected >= ${a.minCitations} citations, got ${nCit}`)
    }
    if (a.maxCitations !== undefined && nCit > a.maxCitations) {
      failures.push(`expected <= ${a.maxCitations} citations, got ${nCit}`)
    }

    for (const title of a.mustCiteMaterial ?? []) {
      if (!obs.citations.some((cit) => includesCi(cit.title, title))) {
        failures.push(`expected a citation to material matching "${title}"`)
      }
    }
    for (const phrase of a.mustMention ?? []) {
      if (!includesCi(obs.answer, phrase)) {
        failures.push(`answer missing required phrase "${phrase}"`)
      }
    }
    for (const phrase of a.forbidPhrases ?? []) {
      if (includesCi(obs.answer, phrase)) {
        failures.push(`answer contains forbidden phrase "${phrase}"`)
      }
    }
    if (a.minAnswerChars !== undefined && obs.answer.length < a.minAnswerChars) {
      failures.push(`answer shorter than ${a.minAnswerChars} chars`)
    }

    if (a.relevantMaterials !== undefined) {
      metrics = citationMetrics(
        obs.citations.map((cit) => cit.title),
        a.relevantMaterials,
      )
      if (a.minCitationPrecision !== undefined && metrics.precision < a.minCitationPrecision) {
        failures.push(`citation precision ${metrics.precision} < ${a.minCitationPrecision}`)
      }
      if (a.minCitationRecall !== undefined && metrics.recall < a.minCitationRecall) {
        failures.push(`citation recall ${metrics.recall} < ${a.minCitationRecall}`)
      }
    }

    failures.push(...faithfulnessFailures(a, obs))
    failures.push(...trustSignalFailures(a, obs))

    if (a.judge !== undefined) {
      if (judge === undefined) {
        failures.push("case has a judge assertion but no judge was provided")
      } else if (!(await judge(a.judge, obs))) {
        failures.push(`judge rejected: ${a.judge}`)
      }
    }
  }

  return {
    id: c.id,
    failureMode: c.failureMode,
    passed: failures.length === 0,
    failures,
    ...(metrics !== undefined ? { precision: metrics.precision, recall: metrics.recall } : {}),
    ...failedAnswer(failures, obs),
  }
}

/** Runs the suite and aggregates pass rate overall + per failure mode. */
export const runEvalSuite = async (
  cases: readonly EvalCase[],
  ask: AskForEval,
  judge?: JudgeForEval,
): Promise<EvalReport> => {
  const results: CaseResult[] = []
  for (const c of cases) {
    // Same schema the server parses KNOWLEDGE_ANSWER_POLICY with: a typo must fail the
    // case here, not run it policy-free and read as an engine failure.
    const policy =
      c.answerPolicy === undefined ? undefined : answerPolicySchema.safeParse(c.answerPolicy)
    if (policy !== undefined && !policy.success) {
      results.push({
        id: c.id,
        failureMode: c.failureMode,
        passed: false,
        failures: [`invalid answerPolicy: ${policy.error.message}`],
      })
      continue
    }
    let obs: EvalObservation
    try {
      obs = await ask(c.query, { answerPolicy: policy?.data })
    } catch (error) {
      results.push({
        id: c.id,
        failureMode: c.failureMode,
        passed: false,
        failures: [`ask threw: ${error instanceof Error ? error.message : String(error)}`],
      })
      continue
    }
    results.push(await evaluateCase(c, obs, judge))
  }

  const byFailureMode: EvalReport["byFailureMode"] = {}
  for (const r of results) {
    const b = (byFailureMode[r.failureMode] ??= { total: 0, passed: 0, passRate: 0 })
    b.total += 1
    if (r.passed) {
      b.passed += 1
    }
  }
  for (const b of Object.values(byFailureMode)) {
    b.passRate = b.total === 0 ? 1 : b.passed / b.total
  }

  const passed = results.filter((r) => r.passed).length
  const scored = results.filter((r) => r.precision !== undefined)
  const mean = (xs: number[]): number =>
    xs.length === 0 ? 0 : Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 1000) / 1000
  return {
    total: results.length,
    passed,
    passRate: results.length === 0 ? 1 : passed / results.length,
    byFailureMode,
    results,
    ...(scored.length > 0
      ? {
          citationPrecision: mean(scored.map((r) => r.precision ?? 0)),
          citationRecall: mean(scored.map((r) => r.recall ?? 0)),
        }
      : {}),
  }
}

/** Minimum pass rate (0..1) per failure mode, e.g. `{ faithfulness: 0.8 }`. */
export type ModeFloors = Readonly<Record<string, number>>

export type FloorBreach = {
  mode: string
  floor: number
  passed: number
  total: number
  passRate: number
}

const isRate = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1

/**
 * Parses BASELINE_PASS_RATE. Unset or blank → 0.8. Anything else must be a rate in
 * [0, 1]: `Number("80%")` is NaN, and `passRate < NaN` is never true — a gate that
 * cannot fail.
 */
export const parseBaselinePassRate = (raw?: string): Result<number, string> => {
  if (raw === undefined || raw.trim() === "") {
    return ok(0.8)
  }
  const rate = Number(raw)
  return isRate(rate)
    ? ok(rate)
    : err(`BASELINE_PASS_RATE must be a rate in [0, 1] (e.g. 0.8), got ${JSON.stringify(raw)}`)
}

/**
 * Parses BASELINE_MODE_FLOORS — a JSON object of failure mode → minimum pass rate
 * in [0, 1]. Unset or blank → no floors. Anything that is not exactly that shape,
 * or names a mode the suite does not have, is an error: a typo must never read as
 * "no floor".
 */
export const parseModeFloors = (
  raw: string | undefined,
  knownModes: readonly string[],
): Result<ModeFloors, string> => {
  if (raw === undefined || raw.trim() === "") {
    return ok({})
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return err(`BASELINE_MODE_FLOORS is not JSON: ${JSON.stringify(raw)}`)
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return err(`BASELINE_MODE_FLOORS must be a JSON object of mode → rate, got ${raw}`)
  }
  const floors: Record<string, number> = {}
  for (const [mode, floor] of Object.entries(parsed)) {
    if (!knownModes.includes(mode)) {
      return err(
        `BASELINE_MODE_FLOORS names "${mode}", which no case has (known: ${knownModes.join(", ")})`,
      )
    }
    if (!isRate(floor)) {
      return err(
        `BASELINE_MODE_FLOORS["${mode}"] must be a rate in [0, 1], got ${JSON.stringify(floor)}`,
      )
    }
    floors[mode] = floor
  }
  return ok(floors)
}

/**
 * Parses EVAL_ONLY — a comma-separated list of failure modes to run. Unset or blank
 * → null (the full suite). A mode no case has is an error: a typo would run zero
 * cases, and an empty run has a pass rate of 1 — it must never read as a pass.
 */
export const parseEvalOnly = (
  raw: string | undefined,
  knownModes: readonly string[],
): Result<readonly string[] | null, string> => {
  const modes = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (modes.length === 0) {
    return ok(null)
  }
  const unknown = modes.filter((m) => !knownModes.includes(m))
  if (unknown.length > 0) {
    return err(
      `EVAL_ONLY names ${unknown.map((m) => `"${m}"`).join(", ")}, which no case has (known: ${knownModes.join(", ")})`,
    )
  }
  return ok(modes)
}

/**
 * The floors that apply to a run restricted to `selected` modes (EVAL_ONLY), and the
 * floored modes it leaves out. Restricting a run on purpose is not a lost measurement,
 * so a floor on a mode the run does not select is skipped (and reported as skipped by
 * the caller), not counted as a 0/0 breach. `selected` null = the full suite.
 */
export const scopeModeFloors = (
  floors: ModeFloors,
  selected: readonly string[] | null,
): { applied: ModeFloors; skipped: string[] } => {
  if (selected === null) {
    return { applied: floors, skipped: [] }
  }
  const applied: Record<string, number> = {}
  const skipped: string[] = []
  for (const [mode, floor] of Object.entries(floors)) {
    if (selected.includes(mode)) {
      applied[mode] = floor
    } else {
      skipped.push(mode)
    }
  }
  return { applied, skipped }
}

/**
 * The failure modes whose pass rate fell under their floor. A floor is a hard
 * minimum (no tolerance): with 5 cases a mode moves in 20% steps, so a tolerance
 * would only blur the line. A floored mode with no cases in the run measured
 * nothing, and nothing measured is not a pass — it is reported as 0/0.
 */
export const modeFloorBreaches = (report: EvalReport, floors: ModeFloors): FloorBreach[] => {
  const breaches: FloorBreach[] = []
  for (const [mode, floor] of Object.entries(floors)) {
    const b = report.byFailureMode[mode]
    if (b === undefined || b.total === 0) {
      breaches.push({ mode, floor, passed: 0, total: 0, passRate: 0 })
    } else if (b.passRate < floor) {
      breaches.push({ mode, floor, passed: b.passed, total: b.total, passRate: b.passRate })
    }
  }
  return breaches
}

/**
 * CI gate: true when the run regressed below baseline (minus tolerance), or any
 * failure mode fell under its floor — so one weak mode cannot hide behind a high
 * overall pass rate.
 */
export const isRegression = (
  report: EvalReport,
  baselinePassRate: number,
  tolerance = 0.02,
  floors: ModeFloors = {},
): boolean =>
  report.passRate < baselinePassRate - tolerance || modeFloorBreaches(report, floors).length > 0
