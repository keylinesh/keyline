/**
 * Envelope encryption — wrap the workspace key to a device public key.
 *
 * This is a sealed-box construction (like libsodium crypto_box_seal):
 *   1. Generate an ephemeral X25519 keypair.
 *   2. ECDH(ephemeral private, recipient public) -> shared secret.
 *   3. HKDF-SHA256(shared, salt = SHA256(ephPub || recipientPub)) -> AES-256 key.
 *   4. AES-256-GCM encrypt the workspace key.
 *
 * Adding or revoking a member re-wraps the workspace key per device. The
 * ciphertext bundles never need re-encrypting.
 *
 * See docs/encryption-design.md.
 */

import {
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  hkdfSync,
  createHash,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
} from "node:crypto";
import { importPublicKey, importPrivateKey, publicKeyDer } from "./keypair.js";

const INFO = Buffer.from("keyline-envelope-v1");
export const WRAP_VERSION = 1;

export interface WrappedKey {
  v: number;
  /** base64 SPKI DER of the ephemeral public key. */
  eph: string;
  /** base64 nonce. */
  nonce: string;
  /** base64 wrapped workspace key. */
  ct: string;
  /** base64 GCM tag. */
  tag: string;
}

/** Bind the derived AES key to both public keys so a wrap can't be replayed to another recipient. */
function deriveWrapKey(shared: Buffer, ephDer: Buffer, recipientDer: Buffer): Buffer {
  const salt = createHash("sha256").update(Buffer.concat([ephDer, recipientDer])).digest();
  return Buffer.from(hkdfSync("sha256", shared, salt, INFO, 32));
}

/** Wrap a 32-byte workspace key to a recipient device public key (base64 SPKI DER). */
export function wrapWorkspaceKey(workspaceKey: Buffer, recipientPublicKeyB64: string): WrappedKey {
  if (workspaceKey.length !== 32) throw new Error("workspace key must be 32 bytes");
  const recipientPub = importPublicKey(recipientPublicKeyB64);
  const recipientDer = publicKeyDer(recipientPub);

  const eph = generateKeyPairSync("x25519");
  const ephDer = publicKeyDer(eph.publicKey);
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: recipientPub });
  const aesKey = deriveWrapKey(shared, ephDer, recipientDer);

  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey, nonce);
  const ct = Buffer.concat([cipher.update(workspaceKey), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: WRAP_VERSION,
    eph: ephDer.toString("base64"),
    nonce: nonce.toString("base64"),
    ct: ct.toString("base64"),
    tag: tag.toString("base64"),
  };
}

/** Unwrap a workspace key with a device private key (base64 PKCS8 DER). */
export function unwrapWorkspaceKey(wrapped: WrappedKey, devicePrivateKeyB64: string): Buffer {
  if (wrapped.v !== WRAP_VERSION) throw new Error(`unsupported wrap version: ${wrapped.v}`);
  const priv = importPrivateKey(devicePrivateKeyB64);
  const recipientDer = publicKeyDer(createPublicKey(priv));

  const ephPub = importPublicKey(wrapped.eph);
  const ephDer = publicKeyDer(ephPub);
  const shared = diffieHellman({ privateKey: priv, publicKey: ephPub });
  const aesKey = deriveWrapKey(shared, ephDer, recipientDer);

  const decipher = createDecipheriv("aes-256-gcm", aesKey, Buffer.from(wrapped.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(wrapped.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(wrapped.ct, "base64")),
    decipher.final(),
  ]);
}

/**
 * Admin-device recovery (crypto primitive): an admin unwraps the workspace key
 * with their device, then re-wraps it to a new device's public key. The full
 * flow (auth, server storage) lives in the API (milestone M2).
 */
export function rewrapWorkspaceKey(
  wrapped: WrappedKey,
  adminPrivateKeyB64: string,
  newDevicePublicKeyB64: string,
): WrappedKey {
  const workspaceKey = unwrapWorkspaceKey(wrapped, adminPrivateKeyB64);
  return wrapWorkspaceKey(workspaceKey, newDevicePublicKeyB64);
}
