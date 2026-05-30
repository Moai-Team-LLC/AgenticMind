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
  /** Phrases the answer MUST contain (case-insensitive). */
  mustMention?: string[]
  /** Phrases the answer MUST NOT contain (e.g. leaked system prompt, fabrications). */
  forbidPhrases?: string[]
  minAnswerChars?: number
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
}

export type AskForEval = (query: string) => Promise<EvalObservation>
export type JudgeForEval = (question: string, observation: EvalObservation) => Promise<boolean>

export type CaseResult = { id: string; failureMode: string; passed: boolean; failures: string[] }

export type EvalReport = {
  total: number
  passed: number
  passRate: number
  byFailureMode: Record<string, { total: number; passed: number; passRate: number }>
  results: CaseResult[]
}

const includesCi = (haystack: string, needle: string): boolean =>
  haystack.toLowerCase().includes(needle.toLowerCase())

/** Applies Level-1 assertions (+ optional judge) to one observation. Pure. */
export const evaluateCase = async (
  c: EvalCase,
  obs: EvalObservation,
  judge?: JudgeForEval,
): Promise<CaseResult> => {
  const a = c.assertions
  const failures: string[] = []

  if (a.expectBlocked === true && !obs.blocked) failures.push("expected the input to be blocked")
  if (a.expectBlocked !== true && obs.blocked) failures.push("input was unexpectedly blocked")

  // Once blocked, answer-level assertions don't apply.
  if (!obs.blocked) {
    const nCit = obs.citations.length
    if (a.minCitations !== undefined && nCit < a.minCitations)
      failures.push(`expected >= ${a.minCitations} citations, got ${nCit}`)
    if (a.maxCitations !== undefined && nCit > a.maxCitations)
      failures.push(`expected <= ${a.maxCitations} citations, got ${nCit}`)

    for (const title of a.mustCiteMaterial ?? []) {
      if (!obs.citations.some((cit) => includesCi(cit.title, title)))
        failures.push(`expected a citation to material matching "${title}"`)
    }
    for (const phrase of a.mustMention ?? []) {
      if (!includesCi(obs.answer, phrase))
        failures.push(`answer missing required phrase "${phrase}"`)
    }
    for (const phrase of a.forbidPhrases ?? []) {
      if (includesCi(obs.answer, phrase))
        failures.push(`answer contains forbidden phrase "${phrase}"`)
    }
    if (a.minAnswerChars !== undefined && obs.answer.length < a.minAnswerChars)
      failures.push(`answer shorter than ${a.minAnswerChars} chars`)

    if (a.judge !== undefined) {
      if (judge === undefined) failures.push("case has a judge assertion but no judge was provided")
      else if (!(await judge(a.judge, obs))) failures.push(`judge rejected: ${a.judge}`)
    }
  }

  return { id: c.id, failureMode: c.failureMode, passed: failures.length === 0, failures }
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
    } catch (e) {
      results.push({
        id: c.id,
        failureMode: c.failureMode,
        passed: false,
        failures: [`ask threw: ${e instanceof Error ? e.message : String(e)}`],
      })
      continue
    }
    results.push(await evaluateCase(c, obs, judge))
  }

  const byFailureMode: EvalReport["byFailureMode"] = {}
  for (const r of results) {
    const b = (byFailureMode[r.failureMode] ??= { total: 0, passed: 0, passRate: 0 })
    b.total += 1
    if (r.passed) b.passed += 1
  }
  for (const b of Object.values(byFailureMode)) b.passRate = b.total === 0 ? 1 : b.passed / b.total

  const passed = results.filter((r) => r.passed).length
  return {
    total: results.length,
    passed,
    passRate: results.length === 0 ? 1 : passed / results.length,
    byFailureMode,
    results,
  }
}

/** CI gate: true when the run regressed below baseline (minus tolerance). */
export const isRegression = (
  report: EvalReport,
  baselinePassRate: number,
  tolerance = 0.02,
): boolean => report.passRate < baselinePassRate - tolerance
