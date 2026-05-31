import { describe, expect, it } from "vitest"

import {
  AGENT_SIGNALS,
  clampStrength,
  defaultStrengthFor,
  FEEDBACK_SIGNALS,
  isAgentSignal,
  isValidSignal,
} from "./feedback"

describe("feedback signals", () => {
  it("freezes the vocabulary (8 human + 7 programmatic = 15)", () => {
    expect(FEEDBACK_SIGNALS).toHaveLength(15)
  })

  it("guards signals", () => {
    expect(isValidSignal("thumb_up")).toBe(true)
    expect(isValidSignal("verified_supported")).toBe(true)
    expect(isValidSignal("shrug")).toBe(false)
  })

  it("marks the programmatic (agent) signals", () => {
    expect(AGENT_SIGNALS.has("verified_supported")).toBe(true)
    expect(isAgentSignal("eval_passed")).toBe(true)
    expect(isAgentSignal("thumb_up")).toBe(false)
  })

  it("assigns signed strengths to programmatic signals", () => {
    expect(defaultStrengthFor("verified_supported")).toBe(1)
    expect(defaultStrengthFor("verification_failed")).toBe(-1)
    expect(defaultStrengthFor("used_in_generation")).toBe(0.5)
  })

  it("assigns signed strengths to human / implicit signals", () => {
    expect(defaultStrengthFor("forwarded_answer")).toBe(0.8)
    expect(defaultStrengthFor("thumb_down")).toBe(-0.7)
    expect(defaultStrengthFor("silent_no_followup")).toBe(0.3)
  })

  it("clamps out-of-range strengths", () => {
    expect(clampStrength(2)).toBe(1)
    expect(clampStrength(-5)).toBe(-1)
    expect(clampStrength(0.5)).toBe(0.5)
  })
})
