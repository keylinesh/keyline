/**
 * Secret bundle layer — symmetric encryption of a set of secrets.
 *
 * A bundle of secrets (e.g. a serialized .env) is sealed with AES-256-GCM under
 * the 32-byte workspace key. The server only ever stores the SealedBundle.
 *
 * See docs/encryption-design.md for the full scheme and threat model.
 */

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const NONCE_BYTES = 12; // GCM standard nonce length
export const BUNDLE_VERSION = 1;

export interface SealedBundle {
  /** Envelope format version, so the scheme can evolve without breaking old data. */
  v: number;
  /** base64-encoded 96-bit nonce. */
  nonce: string;
  /** base64-encoded ciphertext. */
  ciphertext: string;
  /** base64-encoded GCM authentication tag. */
  tag: string;
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`workspace key must be ${KEY_BYTES} bytes (AES-256)`);
  }
}

/** Encrypt plaintext with a 32-byte key. Returns only what the server may store. */
export function sealBundle(plaintext: Buffer | string, key: Buffer): SealedBundle {
  assertKey(key);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, key, nonce);
  const data = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: BUNDLE_VERSION,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
  };
}

/** Decrypt a sealed bundle. Throws if the key is wrong or the data was tampered with. */
export function openBundle(bundle: SealedBundle, key: Buffer): Buffer {
  assertKey(key);
  if (bundle.v !== BUNDLE_VERSION) {
    throw new Error(`unsupported bundle version: ${bundle.v}`);
  }
  const decipher = createDecipheriv(ALGO, key, Buffer.from(bundle.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(bundle.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(bundle.ciphertext, "base64")),
    decipher.final(),
  ]);
}

/** Generate a fresh random 32-byte workspace key (use the KDF for customer-derived keys). */
export function generateWorkspaceKey(): Buffer {
  return randomBytes(KEY_BYTES);
}
