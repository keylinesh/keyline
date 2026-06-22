/**
 * Property / fuzz tests.
 *
 * Round-trip: for many random inputs, decrypt(encrypt(x)) === x across every
 * layer. Tamper: flipping any byte of ciphertext, nonce, tag, or the bound
 * associated material (the envelope's ephemeral key) makes authentication fail.
 *
 * Note: the bundle/recovery GCM constructions carry no separate AAD field. The
 * envelope binds associated material (both public keys) into the HKDF salt, so
 * tampering with `eph` is this scheme's equivalent of AAD tampering — covered.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { sealBundle, openBundle, generateWorkspaceKey } from "./bundle.js";
import { deriveWorkspaceKey, deriveWorkspaceKeyWithSalt } from "./kdf.js";
import { generateDeviceKeyPair } from "./keypair.js";
import { wrapWorkspaceKey, unwrapWorkspaceKey } from "./envelope.js";
import { createRecoveryFile, openRecoveryFile } from "./recovery.js";

const ITERATIONS = 200;
// scrypt is intentionally slow, so KDF/recovery loops use a smaller count.
const KDF_ITERATIONS = 25;

/** Return a copy of a base64 field with one byte flipped (still valid base64). */
function flipB64(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  const i = randomInt(buf.length);
  buf[i] = (buf[i] ?? 0) ^ 0xff;
  return buf.toString("base64");
}

test("property: bundle round-trips for random keys and plaintexts", () => {
  for (let i = 0; i < ITERATIONS; i++) {
    const key = generateWorkspaceKey();
    const plaintext = randomBytes(randomInt(0, 4096));
    const sealed = sealBundle(plaintext, key);
    assert.ok(openBundle(sealed, key).equals(plaintext));
  }
});

test("property: KDF re-derives the same key from the stored salt", () => {
  for (let i = 0; i < KDF_ITERATIONS; i++) {
    const secret = randomBytes(randomInt(1, 64)).toString("hex");
    const { key, salt } = deriveWorkspaceKey(secret);
    assert.ok(deriveWorkspaceKeyWithSalt(secret, salt).equals(key));
  }
});

test("property: envelope wrap/unwrap round-trips to the right device", () => {
  for (let i = 0; i < 50; i++) {
    const wk = generateWorkspaceKey();
    const device = generateDeviceKeyPair();
    const wrapped = wrapWorkspaceKey(wk, device.publicKey);
    assert.ok(unwrapWorkspaceKey(wrapped, device.privateKey).equals(wk));
  }
});

test("property: recovery file round-trips for random passphrases", () => {
  for (let i = 0; i < 20; i++) {
    const wk = generateWorkspaceKey();
    const passphrase = randomBytes(randomInt(1, 48)).toString("base64");
    const file = createRecoveryFile(wk, passphrase);
    assert.ok(openRecoveryFile(file, passphrase).equals(wk));
  }
});

test("tamper: flipping bundle ciphertext / nonce / tag fails to decrypt", () => {
  for (let i = 0; i < ITERATIONS; i++) {
    const key = generateWorkspaceKey();
    const sealed = sealBundle(randomBytes(randomInt(1, 256)), key);
    assert.throws(() => openBundle({ ...sealed, ciphertext: flipB64(sealed.ciphertext) }, key));
    assert.throws(() => openBundle({ ...sealed, nonce: flipB64(sealed.nonce) }, key));
    assert.throws(() => openBundle({ ...sealed, tag: flipB64(sealed.tag) }, key));
  }
});

test("tamper: flipping envelope ct / nonce / tag / eph (AAD-equivalent) fails", () => {
  for (let i = 0; i < 50; i++) {
    const wk = generateWorkspaceKey();
    const device = generateDeviceKeyPair();
    const w = wrapWorkspaceKey(wk, device.publicKey);
    assert.throws(() => unwrapWorkspaceKey({ ...w, ct: flipB64(w.ct) }, device.privateKey));
    assert.throws(() => unwrapWorkspaceKey({ ...w, nonce: flipB64(w.nonce) }, device.privateKey));
    assert.throws(() => unwrapWorkspaceKey({ ...w, tag: flipB64(w.tag) }, device.privateKey));
    // `eph` is bound into the HKDF salt — changing it must break authentication.
    assert.throws(() => unwrapWorkspaceKey({ ...w, eph: flipB64(w.eph) }, device.privateKey));
  }
});

test("tamper: flipping recovery ct / nonce / tag / salt fails to open", () => {
  for (let i = 0; i < 20; i++) {
    const wk = generateWorkspaceKey();
    const pass = "passphrase-under-test";
    const f = createRecoveryFile(wk, pass);
    assert.throws(() => openRecoveryFile({ ...f, ct: flipB64(f.ct) }, pass));
    assert.throws(() => openRecoveryFile({ ...f, nonce: flipB64(f.nonce) }, pass));
    assert.throws(() => openRecoveryFile({ ...f, tag: flipB64(f.tag) }, pass));
    // A different salt derives a different key, so authentication must fail.
    assert.throws(() => openRecoveryFile({ ...f, salt: flipB64(f.salt) }, pass));
  }
});
