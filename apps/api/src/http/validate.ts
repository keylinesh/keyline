/**
 * Request-body validation against a zod schema, producing a consistent
 * validation_error (422) with field-level details on failure.
 */

import type { Context } from "hono";
import type { ZodSchema } from "zod";
import { validationError } from "./errors.js";

export async function parseBody<T>(c: Context, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw validationError([{ path: "", message: "body must be valid JSON" }]);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw validationError(details);
  }
  return result.data;
}
