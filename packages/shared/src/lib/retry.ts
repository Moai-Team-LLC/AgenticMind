import type { Options } from "p-retry"

type RetryAttemptContext = {
  attemptNumber: number
  retriesLeft: number
}

const retryOptions = {
  retries: 10,
  factor: 2,
  minTimeout: 1000,
  maxTimeout: 30_000,
  maxRetryTime: 60_000,
  randomize: true,
  onFailedAttempt: (error: RetryAttemptContext) => {
    console.log(`  ⚠️  Attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`)
  },
} satisfies Options

const buildRetryOptions = (purpose: string) => {
  return {
    ...retryOptions,
    onFailedAttempt: (error: RetryAttemptContext) => {
      console.log(
        `Attempt ${error.attemptNumber} for ${purpose} failed. ${error.retriesLeft} retries left.`,
      )
    },
  }
}

export { retryOptions, buildRetryOptions }
