/**
 * Per-process LLM token accumulator (Cost/FinOps, Layer 9). Fed from the same
 * point that emits the per-call usage span (`recordLlmUsage` in knowledge/llm.ts),
 * so a batch run — the eval gate, a sweep — can print what it spent without an
 * OTEL exporter. Nothing in an MCP response reads it.
 *
 * It counts what the provider reported on calls that RETURNED. A call that threw
 * (a retried timeout, an unparsable structured output) has no usage to count, so
 * the totals are a floor of what was billed, not a bill.
 */

export type ModelUsage = {
  /** Calls that returned. */
  calls: number
  inputTokens: number
  outputTokens: number
  /** Returned calls whose input or output count was missing (counted as 0). */
  callsWithoutUsage: number
}

/** Distinct model ids tracked before the rest fold into OTHER_MODELS (bounds memory
 * in a long-running process). */
const MAX_MODELS = 32
export const OTHER_MODELS = "(other models)"

const totals = new Map<string, ModelUsage>()

const isCount = (n: number | undefined): n is number =>
  n !== undefined && Number.isFinite(n) && n >= 0

/** Adds one returned call's provider-reported usage to the per-model totals. */
export const addLlmUsage = (
  modelId: string,
  usage: { inputTokens?: number; outputTokens?: number },
): void => {
  const key = totals.has(modelId) || totals.size < MAX_MODELS ? modelId : OTHER_MODELS
  const t = totals.get(key) ?? { calls: 0, inputTokens: 0, outputTokens: 0, callsWithoutUsage: 0 }
  t.calls += 1
  t.inputTokens += isCount(usage.inputTokens) ? usage.inputTokens : 0
  t.outputTokens += isCount(usage.outputTokens) ? usage.outputTokens : 0
  if (!isCount(usage.inputTokens) || !isCount(usage.outputTokens)) {
    t.callsWithoutUsage += 1
  }
  totals.set(key, t)
}

/** A copy of the per-model totals so far. */
export const llmUsageSnapshot = (): Record<string, ModelUsage> =>
  Object.fromEntries([...totals].map(([model, t]) => [model, { ...t }]))

/** Clears the totals (tests). */
export const resetLlmUsage = (): void => {
  totals.clear()
}

/**
 * ESTIMATE ONLY — OpenAI standard-tier list prices in USD per 1M tokens, for the
 * eval gate's default models (CHAT_MODEL_SIMPLE / CHAT_MODEL_COMPLEX). Cached
 * input is billed lower, batch and other providers differ, and prices change:
 * the provider's usage page is the bill. A model not listed here gets no $ figure.
 */
const LIST_PRICE_USD_PER_MTOK: Readonly<Record<string, { input: number; output: number }>> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
}

const n = (x: number): string => x.toLocaleString("en-US")
const plural = (k: number, word: string): string => `${k} ${word}${k === 1 ? "" : "s"}`
const usd = (x: number): string => (x > 0 && x < 0.01 ? "< $0.01" : `$${x.toFixed(2)}`)
const noUsage = (k: number): string => (k > 0 ? ` · ${plural(k, "call")} reported no usage` : "")

/**
 * Human-readable usage report: one line per model (tokens in/out, ≈ $ where the
 * model has a list price) and a closing `Usage: … tokens` total line.
 */
export const formatLlmUsageReport = (snapshot: Readonly<Record<string, ModelUsage>>): string[] => {
  const lines: string[] = []
  const priced: string[] = []
  const unpriced: string[] = []
  let cost = 0
  let calls = 0
  let input = 0
  let output = 0
  let missing = 0
  for (const [model, t] of Object.entries(snapshot)) {
    calls += t.calls
    input += t.inputTokens
    output += t.outputTokens
    missing += t.callsWithoutUsage
    const price = LIST_PRICE_USD_PER_MTOK[model]
    let money = "no list price"
    if (price !== undefined) {
      const c = (t.inputTokens * price.input + t.outputTokens * price.output) / 1_000_000
      cost += c
      priced.push(model)
      money = `≈ ${usd(c)}`
    } else {
      unpriced.push(model)
    }
    lines.push(
      `  ${model}: ${plural(t.calls, "call")} · ${n(t.inputTokens)} in / ${n(t.outputTokens)} out tokens · ${money}${noUsage(t.callsWithoutUsage)}`,
    )
  }
  let estimate = "no model call returned"
  if (priced.length > 0 && unpriced.length === 0) {
    estimate = `≈ ${usd(cost)} estimated at list prices, not a bill`
  } else if (priced.length > 0) {
    estimate = `≈ ${usd(cost)} estimated for ${priced.join(", ")} only (no list price: ${unpriced.join(", ")}), not a bill`
  } else if (unpriced.length > 0) {
    estimate = `no $ estimate (no list price: ${unpriced.join(", ")})`
  }
  lines.push(
    `Usage: ${n(input + output)} tokens (${n(input)} in / ${n(output)} out) over ${plural(calls, "call")} · ${estimate}${noUsage(missing)}`,
  )
  return lines
}
