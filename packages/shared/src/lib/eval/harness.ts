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
  /** Optional Level-2 binary judge question; requires a `judge` dep. */
  judge?: string
}

export type EvalCase = {
  id: string
  /** The named failure bucket this case guards against. */
  failureMode: string
  query: string
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
}

export type AskForEval = (query: string) => Promise<EvalObservation>
export type JudgeForEval = (question: string, observation: EvalObservation) => Promise<boolean>

export type CaseResult = {
  id: string
  failureMode: string
  passed: boolean
  failures: string[]
  /** Citation precision/recall, present only when the case declared relevantMaterials. */
  precision?: number
  recall?: number
}

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
    let obs: EvalObservation
    try {
      obs = await ask(c.query)
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

/** CI gate: true when the run regressed below baseline (minus tolerance). */
export const isRegression = (
  report: EvalReport,
  baselinePassRate: number,
  tolerance = 0.02,
): boolean => report.passRate < baselinePassRate - tolerance
