/**
 * Consistent API error model.
 *
 * Every failure becomes `{ error: { code, message, details? } }` with a matching
 * HTTP status. Throw an ApiError (or a helper) anywhere; the app's error handler
 * serializes it. Unexpected errors become a generic 500 (no internals leaked).
 */

export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_error"
  | "conflict"
  | "plan_limit"
  | "payload_too_large"
  | "rate_limited"
  | "internal";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  body(): { error: { code: ErrorCode; message: string; details?: unknown } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export const unauthorized = (m = "authentication required") =>
  new ApiError(401, "unauthorized", m);
export const forbidden = (m = "not allowed") => new ApiError(403, "forbidden", m);
export const notFound = (m = "not found") => new ApiError(404, "not_found", m);
export const conflict = (m = "conflict") => new ApiError(409, "conflict", m);
/** A plan limit was hit; details carry { plan, limit, current } for UIs. */
export const planLimit = (m: string, details?: unknown) =>
  new ApiError(402, "plan_limit", m, details);
export const validationError = (details: unknown, m = "invalid request") =>
  new ApiError(422, "validation_error", m, details);
