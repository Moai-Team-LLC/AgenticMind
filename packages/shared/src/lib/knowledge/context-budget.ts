/**
 * Context-budget packing — agents live in a token budget, so retrieval should
 * return "the best ~N tokens of context", not a fixed count of chunks. Pure: the
 * token estimate is injected (callers pass approxTokens over the chunk body).
 */

/**
 * Greedily keeps items, in the given (already-ranked) order, until adding the
 * next would push the running token estimate over `budget`. Always keeps at
 * least the first item so a tiny budget still returns something. A budget <= 0
 * means "no cap" — all items are returned.
 */
export const packByTokenBudget = <T>(
  items: readonly T[],
  budget: number,
  tokensOf: (item: T) => number,
): T[] => {
  if (budget <= 0) {
    return [...items]
  }
  const out: T[] = []
  let used = 0
  for (const item of items) {
    const t = tokensOf(item)
    if (out.length > 0 && used + t > budget) {
      break
    }
    out.push(item)
    used += t
  }
  return out
}
