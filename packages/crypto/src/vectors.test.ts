import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createCipheriv } from "node:crypto";
import { deriveWorkspaceKeyWithSalt } from "./kdf.js";
import { openBundle } from "./bundle.js";
import { unwrapWorkspaceKey } from "./envelope.js";
import { openRecoveryFile } from "./recovery.js";

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, "vectors.json"), "utf8"));

test("KAT: Node AES-256-GCM matches the published NIST vector", () => {
  const v = vectors.aesGcmNist;
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(v.key, "hex"),
    Buffer.from(v.iv, "hex"),
  );
  const ct = Buffer.concat([
    cipher.update(Buffer.from(v.plaintext, "hex")),
    cipher.final(),
  ]);
  assert.equal(ct.toString("hex"), v.ciphertext);
  assert.equal(cipher.getAuthTag().toString("hex"), v.tag);
});

test("KAT: KDF derives the committed key from a fixed secret + salt", () => {
  const v = vectors.kdf;
  const key = deriveWorkspaceKeyWithSalt(v.secret, v.salt);
  assert.equal(key.toString("base64"), v.key);
});

test("KAT: openBundle decrypts the committed sealed bundle", () => {
  const v = vectors.bundle;
  const plaintext = openBundle(v.bundle, Buffer.from(v.key, "base64"));
  assert.equal(plaintext.toString("utf8"), v.plaintext);
});

test("KAT: unwrap recovers the committed workspace key", () => {
  const v = vectors.envelope;
  const wk = unwrapWorkspaceKey(v.wrapped, v.recipientPrivateKey);
  assert.equal(wk.toString("base64"), v.workspaceKey);
});

test("KAT: openRecoveryFile recovers the committed workspace key", () => {
  const v = vectors.recovery;
  const wk = openRecoveryFile(v.sealed, v.passphrase);
  assert.equal(wk.toString("base64"), v.workspaceKey);
});
