/**
 * Generic database error mapper. The domain-specific NotFound/state-machine
 * error classes from the source product were removed — the knowledge layer maps
 * every DB failure to one opaque `DatabaseError` and lets callers decide.
 */

type DatabaseError = {
  type: "database_error"
  message: string
  originalError: unknown
}

const mapDatabaseError = (
  error: unknown,
  message = error instanceof Error ? error.message : "Unknown database error",
): DatabaseError => {
  return {
    type: "database_error",
    message,
    originalError: error,
  }
}

export { type DatabaseError, mapDatabaseError }
