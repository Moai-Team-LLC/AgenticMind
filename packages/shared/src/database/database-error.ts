/**
 * Generic database error mapper. The knowledge layer deliberately keeps no
 * domain-specific NotFound/state-machine error classes — it maps every DB
 * failure to one opaque `DatabaseError` and lets callers decide.
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
