import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorkspaceKey } from "./bundle.js";
import { createRecoveryFile, openRecoveryFile } from "./recovery.js";

test("seals and recovers the workspace key with the right passphrase", () => {
  const wk = generateWorkspaceKey();
  const file = createRecoveryFile(wk, "a strong recovery passphrase");
  assert.deepEqual(openRecoveryFile(file, "a strong recovery passphrase"), wk);
});

test("wrong passphrase fails", () => {
  const wk = generateWorkspaceKey();
  const file = createRecoveryFile(wk, "a strong recovery passphrase");
  assert.throws(() => openRecoveryFile(file, "wrong passphrase"));
});

test("tampered recovery file fails", () => {
  const wk = generateWorkspaceKey();
  const file = createRecoveryFile(wk, "passphrase");
  const tampered = { ...file, ct: Buffer.from("zzzzzzzzzzzzzzzz").toString("base64") };
  assert.throws(() => openRecoveryFile(tampered, "passphrase"));
});
