/**
 * Runnable demo of the zero-knowledge flow. Run from packages/crypto:
 *   pnpm demo
 *
 * It shows: derive workspace key -> seal secrets -> share with team members ->
 * a teammate decrypts -> a stranger cannot -> recover from a sealed file.
 */

import {
  deriveWorkspaceKey,
  sealBundle,
  openBundle,
  generateDeviceKeyPair,
  wrapWorkspaceKey,
  unwrapWorkspaceKey,
  createRecoveryFile,
  openRecoveryFile,
} from "./src/index.js";

const line = (s = "") => console.log(s);
const show = (label: string, v: string) => console.log(`  ${label.padEnd(16)} ${v}`);

line("1. Derive the workspace key from a customer secret (never sent to server)");
const { key: workspaceKey, salt } = deriveWorkspaceKey("correct-horse-battery-staple");
show("salt (stored)", salt);
show("key length", `${workspaceKey.length} bytes`);

line();
line("2. Seal a .env on the laptop. The server only ever stores this:");
const envFile = "OPENAI_API_KEY=sk-proj-abc123\nDATABASE_URL=postgres://admin:hunter2@db/app";
const sealed = sealBundle(envFile, workspaceKey);
show("ciphertext", sealed.ciphertext.slice(0, 48) + "…");
show("nonce", sealed.nonce);
show("tag", sealed.tag);

line();
line("3. Add two team members (each has a device keypair):");
const alice = generateDeviceKeyPair();
const bob = generateDeviceKeyPair();
const wrappedForAlice = wrapWorkspaceKey(workspaceKey, alice.publicKey);
const wrappedForBob = wrapWorkspaceKey(workspaceKey, bob.publicKey);
show("alice pubkey", alice.publicKey.slice(0, 32) + "…");
show("bob pubkey", bob.publicKey.slice(0, 32) + "…");

line();
line("4. Bob pulls: unwrap the key with his device, then decrypt:");
const bobKey = unwrapWorkspaceKey(wrappedForBob, bob.privateKey);
const bobReads = openBundle(sealed, bobKey).toString("utf8");
show("bob decrypts", "");
bobReads.split("\n").forEach((l) => console.log(`     ${l}`));

line();
line("5. A stranger (Carol) cannot unwrap the key:");
const carol = generateDeviceKeyPair();
try {
  unwrapWorkspaceKey(wrappedForAlice, carol.privateKey);
  console.log("  UNEXPECTED: carol decrypted (bug!)");
} catch {
  show("carol", "rejected ✓ (cannot read the workspace key)");
}

line();
line("6. All devices lost? Recover from a sealed file + passphrase:");
const recovery = createRecoveryFile(workspaceKey, "my-offline-recovery-passphrase");
const recovered = openRecoveryFile(recovery, "my-offline-recovery-passphrase");
show("recovered key", recovered.equals(workspaceKey) ? "matches ✓" : "MISMATCH (bug!)");

line();
line("Done. The server saw only ciphertext and wrapped keys. Never the plaintext.");
