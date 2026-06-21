import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorkspaceKey } from "./bundle.js";
import { generateDeviceKeyPair } from "./keypair.js";
import { wrapWorkspaceKey, unwrapWorkspaceKey, rewrapWorkspaceKey } from "./envelope.js";

test("wraps to a device and unwraps with that device's key", () => {
  const wk = generateWorkspaceKey();
  const alice = generateDeviceKeyPair();
  const wrapped = wrapWorkspaceKey(wk, alice.publicKey);
  assert.deepEqual(unwrapWorkspaceKey(wrapped, alice.privateKey), wk);
});

test("another device cannot unwrap", () => {
  const wk = generateWorkspaceKey();
  const alice = generateDeviceKeyPair();
  const bob = generateDeviceKeyPair();
  const wrapped = wrapWorkspaceKey(wk, alice.publicKey);
  assert.throws(() => unwrapWorkspaceKey(wrapped, bob.privateKey));
});

test("tampered wrap fails to unwrap", () => {
  const wk = generateWorkspaceKey();
  const alice = generateDeviceKeyPair();
  const wrapped = wrapWorkspaceKey(wk, alice.publicKey);
  const tampered = { ...wrapped, ct: Buffer.from("zzzzzzzzzzzzzzzz").toString("base64") };
  assert.throws(() => unwrapWorkspaceKey(tampered, alice.privateKey));
});

test("each wrap uses a fresh ephemeral key (different ciphertext)", () => {
  const wk = generateWorkspaceKey();
  const alice = generateDeviceKeyPair();
  const a = wrapWorkspaceKey(wk, alice.publicKey);
  const b = wrapWorkspaceKey(wk, alice.publicKey);
  assert.notEqual(a.eph, b.eph);
  assert.notEqual(a.ct, b.ct);
});

test("admin re-wrap grants a new device access (recovery primitive)", () => {
  const wk = generateWorkspaceKey();
  const admin = generateDeviceKeyPair();
  const newDevice = generateDeviceKeyPair();
  const adminWrap = wrapWorkspaceKey(wk, admin.publicKey);
  const newWrap = rewrapWorkspaceKey(adminWrap, admin.privateKey, newDevice.publicKey);
  assert.deepEqual(unwrapWorkspaceKey(newWrap, newDevice.privateKey), wk);
});
