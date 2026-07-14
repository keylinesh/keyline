import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { reportError, setErrorSink, Logger } from "./logger.js";

// A logger that drops its output, so tests stay quiet.
function silentLogger() {
  return new Logger(() => {});
}

afterEach(() => setErrorSink(null));

test("reportError forwards to the registered sink with scrubbed-through context", () => {
  const seen: Array<{ err: Error; context: Record<string, unknown> }> = [];
  setErrorSink((err, context) => seen.push({ err, context }));

  reportError(new Error("boom"), { path: "/v1/x", requestId: "r1" }, silentLogger());
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.err.message, "boom");
  assert.equal(seen[0]!.context.path, "/v1/x");
});

test("a non-Error is wrapped before it reaches the sink", () => {
  const received: Error[] = [];
  setErrorSink((err) => received.push(err));
  reportError("string failure", {}, silentLogger());
  assert.ok(received[0] instanceof Error);
  assert.equal(received[0]!.message, "string failure");
});

test("a throwing sink never masks the original error path", () => {
  setErrorSink(() => {
    throw new Error("tracker down");
  });
  // Must not throw.
  assert.doesNotThrow(() => reportError(new Error("boom"), {}, silentLogger()));
});

test("no sink registered is a no-op (dormant without SENTRY_DSN)", () => {
  setErrorSink(null);
  assert.doesNotThrow(() => reportError(new Error("boom"), {}, silentLogger()));
});

test("initSentry is dormant without a DSN and reports live with one", async () => {
  const { initSentry } = await import("./sentry.js");
  assert.equal(initSentry({ dsn: undefined }), false);
  // A syntactically valid DSN pointing nowhere: init returns true, and nothing
  // throws even though the transport can't reach Sentry.
  const live = initSentry({ dsn: "https://examplekey@o0.ingest.sentry.io/0", environment: "test" });
  assert.equal(live, true);
  assert.doesNotThrow(() => reportError(new Error("captured"), { path: "/v1/x" }));
});
