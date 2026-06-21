/**
 * Workspace key derivation.
 *
 * The workspace key is derived from a customer-controlled workspace secret using
 * scrypt (memory-hard KDF, built into Node). The plaintext key never reaches the
 * server. The salt is stored alongside the workspace (it is not secret).
 *
 * See docs/encryption-design.md.
 */

import { scryptSync, randomBytes } from "node:crypto";

const KEY_BYTES = 32;
const SALT_BYTES = 16;

/** scrypt cost parameters. N must be a power of two. */
export const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1 } as const;
/** scrypt at these params needs ~33 MB; raise maxmem above the default 32 MB. */
const MAXMEM = 64 * 1024 * 1024;

export interface DerivedKey {
  /** 32-byte workspace key (keep in memory only; never send to the server). */
  key: Buffer;
  /** base64 salt to persist with the workspace (not secret). */
  salt: string;
}

/** Derive a workspace key. Pass an existing salt to re-derive, or omit to create one. */
export function deriveWorkspaceKey(workspaceSecret: string, salt?: Buffer): DerivedKey {
  const s = salt ?? randomBytes(SALT_BYTES);
  const key = scryptSync(workspaceSecret.normalize("NFKC"), s, KEY_BYTES, {
    ...SCRYPT_PARAMS,
    maxmem: MAXMEM,
  });
  return { key, salt: s.toString("base64") };
}

/** Re-derive a workspace key from a stored base64 salt. */
export function deriveWorkspaceKeyWithSalt(workspaceSecret: string, saltB64: string): Buffer {
  return deriveWorkspaceKey(workspaceSecret, Buffer.from(saltB64, "base64")).key;
}
