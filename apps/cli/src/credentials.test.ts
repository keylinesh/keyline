import { test } from "node:test";
import assert from "node:assert/strict";
import type { KeyStore } from "./keystore.js";
import {
  saveCredentials,
  loadCredentials,
  clearCredentials,
  isCredentialValid,
} from "./credentials.js";

function memStore(): KeyStore {
  const map = new Map<string, string>();
  return {
    backend: "memory",
    get: (a) => map.get(a) ?? null,
    set: (a, s) => void map.set(a, s),
    delete: (a) => void map.delete(a),
  };
}

test("credentials round-trip and clear", () => {
  const store = memStore();
  assert.equal(loadCredentials(store), null);
  saveCredentials({ token: "klk_x", workspaceId: "w1" }, store);
  assert.equal(loadCredentials(store)?.token, "klk_x");
  clearCredentials(store);
  assert.equal(loadCredentials(store), null);
});

test("isCredentialValid: present and unexpired", () => {
  const t0 = new Date("2026-01-01T00:00:00Z");
  assert.equal(isCredentialValid(null), false);
  assert.equal(isCredentialValid({ token: "" }), false);
  assert.equal(isCredentialValid({ token: "klk_x" }), true);
  assert.equal(
    isCredentialValid({ token: "klk_x", expiresAt: "2026-01-01T00:00:01Z" }, t0),
    true,
  );
  assert.equal(
    isCredentialValid({ token: "klk_x", expiresAt: "2025-12-31T23:59:59Z" }, t0),
    false,
  );
});
