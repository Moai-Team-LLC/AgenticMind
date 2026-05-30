import { describe, expect, it } from "vitest"

import { calibrateJudge, computeCalibration, type LabeledExample } from "./judge-calibration"

describe("computeCalibration", () => {
  it("computes TPR/TNR/accuracy + confusion matrix", () => {
    const r = computeCalibration([
      { id: "1", expected: true, got: true }, // tp
      { id: "2", expected: true, got: false }, // fn
      { id: "3", expected: false, got: false }, // tn
      { id: "4", expected: false, got: true }, // fp
      { id: "5", expected: true, got: true }, // tp
    ])
    expect(r.tp).toBe(2)
    expect(r.fn).toBe(1)
    expect(r.tn).toBe(1)
    expect(r.fp).toBe(1)
    expect(r.tpr).toBeCloseTo(2 / 3)
    expect(r.tnr).toBeCloseTo(1 / 2)
    expect(r.accuracy).toBeCloseTo(3 / 5)
    expect(r.misses).toHaveLength(2)
  })

  it("flags calibrated only when both rates clear the threshold", () => {
    const perfect = computeCalibration(
      [
        { id: "a", expected: true, got: true },
        { id: "b", expected: false, got: false },
      ],
      0.8,
    )
    expect(perfect.calibrated).toBe(true)
    const poor = computeCalibration(
      [
        { id: "a", expected: true, got: false },
        { id: "b", expected: false, got: false },
      ],
      0.8,
    )
    expect(poor.calibrated).toBe(false)
  })
})

describe("calibrateJudge", () => {
  it("runs the judge and treats throws as a negative verdict", async () => {
    const examples: LabeledExample[] = [
      { id: "1", input: "grounded", expected: true },
      { id: "2", input: "boom", expected: true },
    ]
    const judge = async (ex: LabeledExample) => {
      if (ex.input === "boom") throw new Error("judge error")
      return true
    }
    const r = await calibrateJudge(examples, judge)
    expect(r.tp).toBe(1)
    expect(r.fn).toBe(1)
  })
})
