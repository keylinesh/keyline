import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveWorkspaceKey, deriveWorkspaceKeyWithSalt } from "./kdf.js";

test("derives a 32-byte key and returns a salt", () => {
  const { key, salt } = deriveWorkspaceKey("correct horse battery staple");
  assert.equal(key.length, 32);
  assert.ok(salt.length > 0);
});

test("same secret + same salt re-derives the same key", () => {
  const first = deriveWorkspaceKey("workspace-secret");
  const again = deriveWorkspaceKeyWithSalt("workspace-secret", first.salt);
  assert.deepEqual(again, first.key);
});

test("different salt yields a different key", () => {
  const a = deriveWorkspaceKey("workspace-secret");
  const b = deriveWorkspaceKey("workspace-secret");
  assert.notDeepEqual(a.key, b.key);
});

test("wrong secret yields a different key", () => {
  const a = deriveWorkspaceKey("workspace-secret");
  const b = deriveWorkspaceKeyWithSalt("WRONG-secret", a.salt);
  assert.notDeepEqual(b, a.key);
});
