import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "@keyline/api/app";
import type { KeyStore } from "../keystore.js";
import { loadAccount } from "../account.js";
import { isCredentialValid, loadCredentials } from "../credentials.js";
import { findProjectConfig } from "../config.js";
import { runLogin } from "./login.js";
import { runLink, slugify } from "./link.js";

/** In-memory keystore. */
function memStore(): KeyStore {
  const map = new Map<string, string>();
  return {
    backend: "memory",
    get: (a) => map.get(a) ?? null,
    set: (a, s) => void map.set(a, s),
    delete: (a) => void map.delete(a),
  };
}

/** A CLI deps object wired to a fresh in-memory API. */
function harness() {
  const app = buildApp(); // memoryDeps (no DATABASE_URL)
  const fetchImpl = ((url: string, init?: RequestInit) =>
    app.request(url, init)) as unknown as typeof fetch;
  return { store: memStore(), apiBaseUrl: "", fetchImpl };
}

test("slugify normalizes project names", () => {
  assert.equal(slugify("My API!"), "my-api");
  assert.equal(slugify("  Web  App  "), "web-app");
});

test("first login onboards a workspace and stores a session", async () => {
  const deps = harness();
  const result = await runLogin(deps, { workspaceName: "Acme", email: "founder@acme.test" });
  assert.equal(result.created, true);
  assert.ok(result.workspaceId);
  assert.ok(isCredentialValid(loadCredentials(deps.store)));
  const account = loadAccount(deps.store);
  assert.equal(account?.email, "founder@acme.test");
  assert.equal(account?.deviceId, result.deviceId);
});

test("second login re-authenticates the same device (no new account)", async () => {
  const deps = harness();
  const first = await runLogin(deps, { workspaceName: "Acme", email: "founder@acme.test" });
  const second = await runLogin(deps, {}); // no flags — uses the stored account
  assert.equal(second.created, false);
  assert.equal(second.deviceId, first.deviceId);
  assert.equal(second.workspaceId, first.workspaceId);
});

test("first login without flags gives a friendly error", async () => {
  const deps = harness();
  await assert.rejects(() => runLogin(deps, {}), /keyline login --workspace/);
});

test("link creates project + environment and writes the binding", async () => {
  const deps = harness();
  await runLogin(deps, { workspaceName: "Acme", email: "founder@acme.test" });
  const dir = mkdtempSync(join(tmpdir(), "keyline-link-"));
  try {
    const cfg = await runLink(deps, { project: "My API", environment: "prod", dir });
    assert.equal(cfg.projectSlug, "my-api");
    assert.equal(cfg.environmentName, "prod");
    const found = findProjectConfig(dir);
    assert.equal(found?.config.projectId, cfg.projectId);
    assert.equal(found?.config.environmentId, cfg.environmentId);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("re-linking is idempotent (reuses the existing project/env)", async () => {
  const deps = harness();
  await runLogin(deps, { workspaceName: "Acme", email: "founder@acme.test" });
  const dir = mkdtempSync(join(tmpdir(), "keyline-link-"));
  try {
    const a = await runLink(deps, { project: "api", environment: "prod", dir });
    const b = await runLink(deps, { project: "api", environment: "prod", dir });
    assert.equal(a.projectId, b.projectId);
    assert.equal(a.environmentId, b.environmentId);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("link before login is rejected with a friendly error", async () => {
  const deps = harness();
  await assert.rejects(
    () => runLink(deps, { project: "api", environment: "prod" }),
    /login/,
  );
});
