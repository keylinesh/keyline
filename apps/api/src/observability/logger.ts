/**
 * Structured JSON logging (#29).
 *
 * One JSON object per line to stdout — ingested by Vercel / any log pipeline.
 * Crucially for a zero-knowledge product: it NEVER logs secret material. Request
 * bodies are never passed in, and a redactor blanks any field whose name looks
 * sensitive (token, authorization, ciphertext, private key, …) as defense in
 * depth.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;
export type LogSink = (line: string) => void;

const SENSITIVE = new Set([
  "authorization",
  "token",
  "tokenhash",
  "password",
  "secret",
  "ciphertext",
  "ct",
  "tag",
  "nonce",
  "eph",
  "answer",
  "challenge",
  "privatekey",
  "private_key",
  "kdfsalt",
  "kdf_salt",
  "workspacekey",
  "cookie",
]);

/** Recursively blank any field whose key looks sensitive. */
export function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (SENSITIVE.has(key.toLowerCase())) {
      out[key] = "[redacted]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redact(value as LogFields);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Default sink: JSON to stdout, silenced under KEYLINE_LOG_SILENT (tests). */
const defaultSink: LogSink = (line) => {
  if (!process.env.KEYLINE_LOG_SILENT) console.log(line);
};

export class Logger {
  constructor(
    private readonly sink: LogSink = defaultSink,
    private readonly base: LogFields = {},
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  /** Derive a logger that always includes `fields` (e.g. a request id). */
  child(fields: LogFields): Logger {
    return new Logger(this.sink, { ...this.base, ...fields }, this.clock);
  }

  private emit(level: LogLevel, msg: string, fields: LogFields): void {
    this.sink(
      JSON.stringify({ ts: this.clock(), level, msg, ...redact({ ...this.base, ...fields }) }),
    );
  }

  debug(msg: string, fields: LogFields = {}): void {
    this.emit("debug", msg, fields);
  }
  info(msg: string, fields: LogFields = {}): void {
    this.emit("info", msg, fields);
  }
  warn(msg: string, fields: LogFields = {}): void {
    this.emit("warn", msg, fields);
  }
  error(msg: string, fields: LogFields = {}): void {
    this.emit("error", msg, fields);
  }
}

/** Default process logger. */
export const logger = new Logger();

/**
 * An error sink forwards reported errors to an external tracker. Registered at
 * process init (see observability/sentry.ts) so this module stays free of any
 * hard tracker dependency.
 */
export type ErrorSink = (err: Error, context: LogFields) => void;

let errorSink: ErrorSink | null = null;

export function setErrorSink(sink: ErrorSink | null): void {
  errorSink = sink;
}

/**
 * Report an unexpected error to the log (level=error) with its stack, and to
 * the registered error tracker if one is wired (Sentry when SENTRY_DSN is set).
 * See docs/observability.md.
 */
export function reportError(err: unknown, context: LogFields = {}, log: Logger = logger): void {
  const e = err instanceof Error ? err : new Error(String(err));
  log.error("unhandled_error", { ...context, errorName: e.name, error: e.message, stack: e.stack });
  try {
    errorSink?.(e, context);
  } catch {
    // A broken tracker must never mask the original error.
  }
}
