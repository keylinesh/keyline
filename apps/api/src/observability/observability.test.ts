import { test } from "node:test";
import assert from "node:assert/strict";
import { Logger, redact, reportError } from "./logger.js";
import { Metrics } from "./metrics.js";
import { createApp } from "../http/app.js";
import { memoryDeps } from "../deps.js";

function capture() {
  const lines: any[] = [];
  const logger = new Logger((line) => lines.push(JSON.parse(line)), {}, () => "2026-01-01T00:00:00.000Z");
  return { logger, lines };
}

test("redact blanks sensitive keys, recursively, keeps the rest", () => {
  const out = redact({
    method: "POST",
    authorization: "Bearer klk_secret",
    token: "klk_x",
    nested: { ciphertext: "abc", version: 2 },
    keep: "ok",
  });
  assert.equal(out.method, "POST");
  assert.equal(out.authorization, "[redacted]");
  assert.equal(out.token, "[redacted]");
  assert.deepEqual(out.nested, { ciphertext: "[redacted]", version: 2 });
  assert.equal(out.keep, "ok");
});

test("logger emits structured JSON with level + fields", () => {
  const { logger, lines } = capture();
  logger.info("request", { status: 200, route: "/health" });
  assert.equal(lines[0].level, "info");
  assert.equal(lines[0].msg, "request");
  assert.equal(lines[0].status, 200);
  assert.equal(lines[0].ts, "2026-01-01T00:00:00.000Z");
});

test("reportError logs an error with name + stack, redacting context", () => {
  const { logger, lines } = capture();
  reportError(new Error("boom"), { token: "klk_x", path: "/v1/x" }, logger);
  assert.equal(lines[0].level, "error");
  assert.equal(lines[0].error, "boom");
  assert.ok(lines[0].stack.includes("boom"));
  assert.equal(lines[0].token, "[redacted]");
});

test("metrics count requests and accumulate duration per route", () => {
  const m = new Metrics();
  m.observe("GET", "/v1/x", 200, 10);
  m.observe("GET", "/v1/x", 200, 30);
  m.observe("GET", "/v1/x", 404, 5);
  const snap = m.snapshot();
  assert.equal(snap.requests["GET|/v1/x|200"], 2);
  assert.equal(snap.requests["GET|/v1/x|404"], 1);
  assert.deepEqual(snap.durationMs["GET|/v1/x"], { sum: 45, count: 3 });
  assert.match(m.render(), /http_requests_total\{method="GET",route="\/v1\/x",status="200"\} 2/);
});

test("each request emits a log line and increments metrics; no token is logged", async () => {
  const { logger, lines } = capture();
  const metrics = new Metrics();
  const deps = memoryDeps();
  const app = createApp(deps, { logger, metrics });
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: "c2FsdA==" });
  const { token } = await deps.tokens.issue({
    deviceId: "dev-1", memberId: "mem-1", scope: { workspaceId: ws.id, role: "admin" },
  });

  const res = await app.request(`/v1/workspaces/${ws.id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);

  const reqLog = lines.find((l) => l.msg === "request");
  assert.ok(reqLog);
  assert.equal(reqLog.status, 200);
  assert.equal(reqLog.memberId, "mem-1");
  assert.equal(reqLog.route, "/v1/workspaces/:id");
  // The bearer token must never appear anywhere in the logs.
  assert.ok(!JSON.stringify(lines).includes(token));

  assert.equal(metrics.snapshot().requests["GET|/v1/workspaces/:id|200"], 1);
});

test("/metrics exposes Prometheus text", async () => {
  const metrics = new Metrics();
  const app = createApp(memoryDeps(), { metrics });
  await app.request("/health");
  const res = await app.request("/metrics");
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /http_requests_total/);
});
