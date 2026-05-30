import type { Result } from "neverthrow"
import type * as z from "zod"

import { err, ok } from "neverthrow"

export const parseZodSchema = <T>(
  schema: z.ZodType<T>,
  data: unknown,
): Result<T, { type: "zod_error"; message: string }> => {
  const result = schema.safeParse(data)

  if (result.success) {
    return ok(result.data)
  }

  return err({
    type: "zod_error",
    message: result.error.issues
      .map(({ message, path }) => {
        if (path.length === 0) {
          return message
        }
        return `${path.join(".")}: ${message}`
      })
      .join(", "),
  } as const)
}
