import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadOrCreateDeviceIdentity,
  clearDeviceIdentity,
  registrationOf,
  registerDevice,
} from "./device.js";
import type { KeyStore } from "./keystore.js";

/** In-memory KeyStore for tests. */
function memStore(): KeyStore {
  const map = new Map<string, string>();
  return {
    backend: "memory",
    get: (a) => map.get(a) ?? null,
    set: (a, s) => void map.set(a, s),
    delete: (a) => void map.delete(a),
  };
}

test("generates and persists an identity on first login", () => {
  const store = memStore();
  const first = loadOrCreateDeviceIdentity(store);
  assert.equal(first.created, true);
  assert.ok(first.identity.deviceId.length > 0);
  assert.ok(first.identity.publicKey.length > 0);
  assert.ok(first.identity.privateKey.length > 0);
});

test("is idempotent: second login returns the same identity", () => {
  const store = memStore();
  const a = loadOrCreateDeviceIdentity(store);
  const b = loadOrCreateDeviceIdentity(store);
  assert.equal(b.created, false);
  assert.deepEqual(b.identity, a.identity);
});

test("reset clears the identity so the next login regenerates", () => {
  const store = memStore();
  const a = loadOrCreateDeviceIdentity(store);
  clearDeviceIdentity(store);
  const b = loadOrCreateDeviceIdentity(store);
  assert.equal(b.created, true);
  assert.notEqual(b.identity.deviceId, a.identity.deviceId);
});

test("corrupt stored identity throws a clear error", () => {
  const store = memStore();
  store.set("device-identity", "not json");
  assert.throws(() => loadOrCreateDeviceIdentity(store), /corrupt/);
});

test("registration never includes the private key", () => {
  const store = memStore();
  const { identity } = loadOrCreateDeviceIdentity(store);
  const reg = registrationOf(identity);
  assert.deepEqual(Object.keys(reg).sort(), ["deviceId", "publicKey"]);
  assert.ok(!("privateKey" in reg));
});

test("registerDevice sends only public material to the transport", async () => {
  const store = memStore();
  const { identity } = loadOrCreateDeviceIdentity(store);
  let sent: unknown;
  await registerDevice(identity, (reg) => {
    sent = reg;
  });
  assert.deepEqual(sent, {
    deviceId: identity.deviceId,
    publicKey: identity.publicKey,
  });
  assert.ok(!JSON.stringify(sent).includes(identity.privateKey));
});
