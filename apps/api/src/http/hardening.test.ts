import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./app.js";
import { memoryDeps } from "../deps.js";
import { MemoryRateLimitStore, rateLimit, tokenOrIpKey } from "./middleware/rate-limit.js";
import { Hono } from "hono";

test("responses carry security headers", async () => {
  const app = createApp(memoryDeps());
  const res = await app.request("/health");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  // secureHeaders sets X-Frame-Options and a Strict-Transport-Security policy.
  assert.ok(res.headers.get("x-frame-options"));
  assert.ok(res.headers.get("strict-transport-security"));
});

test("rate limit returns 429 after the max is exceeded", async () => {
  const app = createApp(memoryDeps(), { rateLimit: { windowMs: 60_000, max: 2 } });
  assert.equal((await app.request("/health")).status, 200);
  assert.equal((await app.request("/health")).status, 200);
  const limited = await app.request("/health");
  assert.equal(limited.status, 429);
  assert.equal((await limited.json() as any).error.code, "rate_limited");
  assert.ok(limited.headers.get("retry-after"));
});

test("rate limit window resets (fixed window, injected clock)", () => {
  const store = new MemoryRateLimitStore();
  let t = 1000;
  const r1 = store.hit("k", 1000, t); // count 1
  const r2 = store.hit("k", 1000, t); // count 2
  assert.equal(r1.count, 1);
  assert.equal(r2.count, 2);
  t += 1001; // past resetAt
  const r3 = store.hit("k", 1000, t);
  assert.equal(r3.count, 1); // new window
});

test("per-token and per-IP keys are independent", async () => {
  // Two different bearer tokens get separate buckets at max=1.
  const sub = new Hono();
  sub.use("*", rateLimit({ windowMs: 60_000, max: 1, keyFn: tokenOrIpKey, store: new MemoryRateLimitStore() }));
  sub.get("/x", (c) => c.text("ok"));
  const a1 = await sub.request("/x", { headers: { authorization: "Bearer A" } });
  const a2 = await sub.request("/x", { headers: { authorization: "Bearer A" } });
  const b1 = await sub.request("/x", { headers: { authorization: "Bearer B" } });
  assert.equal(a1.status, 200);
  assert.equal(a2.status, 429); // same token, second hit blocked
  assert.equal(b1.status, 200); // different token, own bucket
});

test("oversized request body is rejected with 413", async () => {
  const app = createApp(memoryDeps(), { bodyLimitBytes: 50 });
  const big = "x".repeat(500);
  const res = await app.request("/v1/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ blob: big }),
  });
  assert.equal(res.status, 413);
  assert.equal((await res.json() as any).error.code, "payload_too_large");
});

test("HTTPS is required when enabled (x-forwarded-proto)", async () => {
  const app = createApp(memoryDeps(), { requireHttps: true });
  const http = await app.request("/health", { headers: { "x-forwarded-proto": "http" } });
  assert.equal(http.status, 403);
  const https = await app.request("/health", { headers: { "x-forwarded-proto": "https" } });
  assert.equal(https.status, 200);
});

test("validation still rejects bad input with 422", async () => {
  const deps = memoryDeps();
  const app = createApp(deps);
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: "c2FsdA==" });
  const { token } = await deps.tokens.issue({
    deviceId: "d", memberId: "m", scope: { workspaceId: ws.id, role: "admin" },
  });
  const res = await app.request(`/v1/workspaces/${ws.id}/projects`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "", slug: "Bad Slug" }),
  });
  assert.equal(res.status, 422);
});
