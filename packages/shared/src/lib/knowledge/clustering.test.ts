import { describe, expect, it } from "vitest"

import {
  CLUSTER_MATCH_THRESHOLD,
  MIN_CLUSTER_SIZE,
  MIN_CLUSTER_SIZE_FAST_TRACK,
  PROMOTION_SCORE_THRESHOLD,
  shouldJoinCluster,
} from "./clustering"

describe("clustering thresholds", () => {
  it("freezes the Go-calibrated constants", () => {
    expect(MIN_CLUSTER_SIZE).toBe(5)
    expect(MIN_CLUSTER_SIZE_FAST_TRACK).toBe(3)
    expect(PROMOTION_SCORE_THRESHOLD).toBe(0.7)
    expect(CLUSTER_MATCH_THRESHOLD).toBe(0.85)
  })

  it("joins only at or above the cosine cutoff", () => {
    expect(shouldJoinCluster(0.85)).toBe(true)
    expect(shouldJoinCluster(0.92)).toBe(true)
    expect(shouldJoinCluster(0.8499)).toBe(false)
    expect(shouldJoinCluster(0)).toBe(false)
  })
})
