import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRuntimeConfig } from "./server.js";
import { createApp } from "./http/app.js";
import { memoryDeps } from "./deps.js";

test("APP_ENV is authoritative over NODE_ENV", () => {
  const cfg = resolveRuntimeConfig({ APP_ENV: "staging", NODE_ENV: "production" });
  assert.equal(cfg.environment, "staging");
});

test("falls back to NODE_ENV, then development", () => {
  assert.equal(resolveRuntimeConfig({ NODE_ENV: "production" }).environment, "production");
  assert.equal(resolveRuntimeConfig({}).environment, "development");
});

test("HTTPS is required for staging and production, not development", () => {
  assert.equal(resolveRuntimeConfig({ APP_ENV: "development" }).requireHttps, false);
  assert.equal(resolveRuntimeConfig({ APP_ENV: "staging" }).requireHttps, true);
  assert.equal(resolveRuntimeConfig({ APP_ENV: "production" }).requireHttps, true);
});

test("/health reports the configured environment", async () => {
  const app = createApp(memoryDeps(), { environment: "staging" });
  const body = (await (await app.request("/health")).json()) as any;
  assert.equal(body.status, "ok");
  assert.equal(body.environment, "staging");
});
