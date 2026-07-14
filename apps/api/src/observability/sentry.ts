/**
 * Sentry error tracking (#63). Dormant unless SENTRY_DSN is set, so local dev
 * and tests need nothing. Wired at the process edge (Node server + Vercel
 * function): initSentry() registers the error sink that reportError() forwards
 * to. On serverless, call flushSentry() after each request so queued events
 * aren't lost when the function freezes.
 */

import * as Sentry from "@sentry/node";
import { setErrorSink, type LogFields } from "./logger.js";

let initialized = false;

export interface SentryConfig {
  dsn?: string;
  environment?: string;
  /** Deployed commit, for release health + stack mapping. */
  release?: string;
}

/**
 * Initialize Sentry if a DSN is configured. Idempotent and safe to call on
 * every warm serverless invocation. Returns true when tracking is live.
 */
export function initSentry(config: SentryConfig = {}): boolean {
  const dsn = config.dsn ?? process.env.SENTRY_DSN;
  if (!dsn) return false;
  if (!initialized) {
    Sentry.init({
      dsn,
      environment: config.environment ?? process.env.APP_ENV ?? process.env.NODE_ENV ?? "production",
      release: config.release ?? process.env.VERCEL_GIT_COMMIT_SHA,
      // Errors only by default; sampling perf traces is a later dial.
      tracesSampleRate: 0,
      // Belt-and-braces: never let request bodies (ciphertext, tokens) leave.
      sendDefaultPii: false,
      beforeSend: scrubEvent,
    });
    setErrorSink((err, context) => {
      Sentry.captureException(err, { extra: scrubContext(context) });
    });
    initialized = true;
  }
  return true;
}

/** Flush queued events (serverless: call before the function returns). */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (initialized) await Sentry.flush(timeoutMs);
}

/** Keep secret-shaped fields out of Sentry even though we never set them. */
const SECRET_KEYS = /token|secret|password|authorization|cookie|bundle|ciphertext|wrapped/i;

function scrubContext(context: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(context)) {
    out[k] = SECRET_KEYS.test(k) ? "[redacted]" : v;
  }
  return out;
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  // The API never handles plaintext secrets, but strip request data anyway so
  // an accidental future field can't leak. Headers/cookies/body dropped.
  if (event.request) {
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.data;
  }
  return event;
}
