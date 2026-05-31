/**
 * LLM-as-judge calibration — the step most teams skip. Before an LLM judge is
 * trusted (Level 2 of the eval pyramid), run it against a human-labeled set and
 * measure TPR (catches real positives) + TNR (rejects real negatives). A judge
 * is "calibrated" only when BOTH clear the threshold (Standard: >0.8). Report
 * every release. Judges return BINARY verdicts — never Likert.
 */

export type LabeledExample = {
  id: string
  /** What the judge evaluates (e.g. answer + its citations, serialised). */
  input: string
  /** The human ground-truth label: true = should pass / is supported. */
  expected: boolean
}

export type JudgeFn = (example: LabeledExample) => Promise<boolean>

export type CalibrationReport = {
  total: number
  tp: number
  fp: number
  tn: number
  fn: number
  /** True-positive rate = tp / (tp + fn) — recall on the "should pass" set. */
  tpr: number
  /** True-negative rate = tn / (tn + fp) — correct rejections. */
  tnr: number
  accuracy: number
  threshold: number
  /** Both TPR and TNR clear the threshold. */
  calibrated: boolean
  /** Examples the judge got wrong — the next iteration's prompt-tuning fuel. */
  misses: { id: string; expected: boolean; got: boolean }[]
}

/** Pure confusion-matrix math over judge verdicts vs labels. */
export const computeCalibration = (
  results: readonly { id: string; expected: boolean; got: boolean }[],
  threshold = 0.8,
): CalibrationReport => {
  let tp = 0
  let fp = 0
  let tn = 0
  let fn = 0
  const misses: { id: string; expected: boolean; got: boolean }[] = []
  for (const r of results) {
    if (r.expected && r.got) {
      tp += 1
    } else if (r.expected && !r.got) {
      fn += 1
      misses.push(r)
    } else if (!r.expected && r.got) {
      fp += 1
      misses.push(r)
    } else {
      tn += 1
    }
  }
  const tpr = tp + fn === 0 ? 1 : tp / (tp + fn)
  const tnr = tn + fp === 0 ? 1 : tn / (tn + fp)
  const total = results.length
  const accuracy = total === 0 ? 1 : (tp + tn) / total
  return {
    total,
    tp,
    fp,
    tn,
    fn,
    tpr,
    tnr,
    accuracy,
    threshold,
    calibrated: tpr >= threshold && tnr >= threshold,
    misses,
  }
}

/** Runs the judge over the labeled set, then computes calibration. */
export const calibrateJudge = async (
  examples: readonly LabeledExample[],
  judge: JudgeFn,
  threshold = 0.8,
): Promise<CalibrationReport> => {
  const results: { id: string; expected: boolean; got: boolean }[] = []
  for (const ex of examples) {
    let got = false
    try {
      got = await judge(ex)
    } catch {
      got = false
    }
    results.push({ id: ex.id, expected: ex.expected, got })
  }
  return computeCalibration(results, threshold)
}
