import { test } from "node:test";
import assert from "node:assert/strict";
import { sealBundle, openBundle, generateWorkspaceKey } from "./index.js";

test("round-trips a secret bundle", () => {
  const key = generateWorkspaceKey();
  const plaintext = "STRIPE_SECRET_KEY=sk_live_example\nDATABASE_URL=postgres://x";
  const sealed = sealBundle(plaintext, key);
  assert.equal(openBundle(sealed, key).toString("utf8"), plaintext);
});

test("rejects the wrong key", () => {
  const sealed = sealBundle("secret", generateWorkspaceKey());
  assert.throws(() => openBundle(sealed, generateWorkspaceKey()));
});

test("detects tampering with the ciphertext", () => {
  const key = generateWorkspaceKey();
  const sealed = sealBundle("secret", key);
  const tampered = { ...sealed, ciphertext: Buffer.from("zzzz").toString("base64") };
  assert.throws(() => openBundle(tampered, key));
});

test("rejects a non-256-bit key", () => {
  assert.throws(() => sealBundle("secret", Buffer.alloc(16)));
});
