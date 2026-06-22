/**
 * Regenerate src/vectors.json — the committed known-answer test (KAT) vectors.
 *
 * Run with:  pnpm --filter @keyline/crypto gen:vectors
 *
 * The vectors lock down: (1) the AES-256-GCM primitive against a public NIST
 * test vector, and (2) our on-the-wire formats (KDF, bundle, envelope, recovery)
 * so an accidental format or parameter change is caught by the test suite.
 *
 * Format/decrypt vectors are produced once here and committed; the values are
 * arbitrary-but-fixed. The NIST vector is a published constant, asserted below.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createCipheriv, generateKeyPairSync } from "node:crypto";
import { deriveWorkspaceKeyWithSalt } from "../src/kdf.js";
import { openBundle, type SealedBundle } from "../src/bundle.js";
import { wrapWorkspaceKey, unwrapWorkspaceKey } from "../src/envelope.js";
import { createRecoveryFile, openRecoveryFile } from "../src/recovery.js";

const b64 = (b: Buffer) => b.toString("base64");

// --- 1. NIST AES-256-GCM known-answer vector (McGrew & Viega, Test Case 14) ---
// K = 32 zero bytes, IV = 12 zero bytes, P = 16 zero bytes, no AAD.
// Published expected values:
const NIST = {
  key: "0".repeat(64),
  iv: "0".repeat(24),
  plaintext: "0".repeat(32),
  ciphertext: "cea7403d4d606b6e074ec5d3baf39d18",
  tag: "d0d1c8a799996bf0265b98b5d48ab919",
};
{
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(NIST.key, "hex"),
    Buffer.from(NIST.iv, "hex"),
  );
  const ct = Buffer.concat([
    cipher.update(Buffer.from(NIST.plaintext, "hex")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  if (ct.toString("hex") !== NIST.ciphertext || tag.toString("hex") !== NIST.tag) {
    throw new Error(
      `Node's AES-256-GCM disagrees with the NIST vector!\n` +
        `  ct  got ${ct.toString("hex")} want ${NIST.ciphertext}\n` +
        `  tag got ${tag.toString("hex")} want ${NIST.tag}`,
    );
  }
}

// --- 2. KDF vector (scrypt, deterministic) ---
const kdfSecret = "correct horse battery staple";
const kdfSalt = b64(Buffer.from("0123456789abcdef", "utf8")); // 16 bytes
const kdfKey = b64(deriveWorkspaceKeyWithSalt(kdfSecret, kdfSalt));

// --- 3. Bundle decrypt vector (fixed key + nonce -> fixed ct/tag) ---
const bundleKey = Buffer.alloc(32, 7);
const bundleNonce = Buffer.alloc(12, 9);
const bundlePlaintext = "STRIPE_SECRET_KEY=sk_live_x\nDATABASE_URL=postgres://h/db";
const bc = createCipheriv("aes-256-gcm", bundleKey, bundleNonce);
const bundleCt = Buffer.concat([bc.update(bundlePlaintext, "utf8"), bc.final()]);
const bundle: SealedBundle = {
  v: 1,
  nonce: b64(bundleNonce),
  ciphertext: b64(bundleCt),
  tag: b64(bc.getAuthTag()),
};
if (openBundle(bundle, bundleKey).toString("utf8") !== bundlePlaintext) {
  throw new Error("bundle vector does not round-trip through openBundle");
}

// --- 4. Envelope decrypt vector (fixed wrapped blob -> workspace key) ---
const recipient = generateKeyPairSync("x25519");
const recipientPriv = b64(
  recipient.privateKey.export({ format: "der", type: "pkcs8" }) as Buffer,
);
const recipientPub = b64(
  recipient.publicKey.export({ format: "der", type: "spki" }) as Buffer,
);
const envWorkspaceKey = Buffer.alloc(32, 0x42);
const wrapped = wrapWorkspaceKey(envWorkspaceKey, recipientPub);
if (!unwrapWorkspaceKey(wrapped, recipientPriv).equals(envWorkspaceKey)) {
  throw new Error("envelope vector does not round-trip");
}

// --- 5. Recovery decrypt vector (fixed sealed file + passphrase) ---
const recPassphrase = "a strong recovery passphrase";
const recWorkspaceKey = Buffer.alloc(32, 0xab);
const sealed = createRecoveryFile(recWorkspaceKey, recPassphrase);
if (!openRecoveryFile(sealed, recPassphrase).equals(recWorkspaceKey)) {
  throw new Error("recovery vector does not round-trip");
}

const vectors = {
  _comment:
    "Known-answer vectors for @keyline/crypto. Regenerate with `pnpm gen:vectors`. " +
    "The aesGcmNist entry is a published NIST constant; the rest lock our wire formats.",
  aesGcmNist: NIST,
  kdf: { secret: kdfSecret, salt: kdfSalt, key: kdfKey },
  bundle: { key: b64(bundleKey), bundle, plaintext: bundlePlaintext },
  envelope: {
    recipientPrivateKey: recipientPriv,
    wrapped,
    workspaceKey: b64(envWorkspaceKey),
  },
  recovery: {
    passphrase: recPassphrase,
    sealed,
    workspaceKey: b64(recWorkspaceKey),
  },
};

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "vectors.json");
writeFileSync(out, JSON.stringify(vectors, null, 2) + "\n");
console.log(`wrote ${out}`);
console.log("NIST AES-256-GCM vector verified against published constants.");
