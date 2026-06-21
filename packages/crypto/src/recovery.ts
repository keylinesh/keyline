/**
 * Sealed recovery file.
 *
 * An optional customer-held artifact for the "all devices lost" case. The
 * workspace key is sealed with AES-256-GCM under a key derived (scrypt) from a
 * recovery passphrase the customer controls and stores themselves.
 *
 * Honest limit: if every device is lost and there is no recovery file, the
 * secrets are unrecoverable. That is the point of zero-knowledge.
 *
 * See docs/encryption-design.md.
 */

import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { SCRYPT_PARAMS } from "./kdf.js";

export const RECOVERY_VERSION = 1;
const MAXMEM = 64 * 1024 * 1024;

export interface SealedRecoveryFile {
  v: number;
  salt: string;
  nonce: string;
  ct: string;
  tag: string;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase.normalize("NFKC"), salt, 32, { ...SCRYPT_PARAMS, maxmem: MAXMEM });
}

/** Seal the workspace key under a recovery passphrase. */
export function createRecoveryFile(workspaceKey: Buffer, passphrase: string): SealedRecoveryFile {
  if (workspaceKey.length !== 32) throw new Error("workspace key must be 32 bytes");
  const salt = randomBytes(16);
  const aesKey = deriveKey(passphrase, salt);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey, nonce);
  const ct = Buffer.concat([cipher.update(workspaceKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: RECOVERY_VERSION,
    salt: salt.toString("base64"),
    nonce: nonce.toString("base64"),
    ct: ct.toString("base64"),
    tag: tag.toString("base64"),
  };
}

/** Recover the workspace key from a sealed file + passphrase. Throws on wrong passphrase or tampering. */
export function openRecoveryFile(file: SealedRecoveryFile, passphrase: string): Buffer {
  if (file.v !== RECOVERY_VERSION) throw new Error(`unsupported recovery version: ${file.v}`);
  const aesKey = deriveKey(passphrase, Buffer.from(file.salt, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", aesKey, Buffer.from(file.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(file.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(file.ct, "base64")),
    decipher.final(),
  ]);
}
