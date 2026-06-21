/**
 * Device keypairs.
 *
 * Each device gets an X25519 keypair on first login. The private key stays on the
 * device (OS keychain where available); only the public key is registered with
 * the server. The keypair is used for envelope encryption (see envelope.ts).
 *
 * Keys are stored as base64 DER: SPKI for public keys, PKCS8 for private keys.
 */

import {
  generateKeyPairSync,
  createPublicKey,
  createPrivateKey,
  type KeyObject,
} from "node:crypto";

export interface DeviceKeyPair {
  /** base64 SPKI DER. Safe to send to the server. */
  publicKey: string;
  /** base64 PKCS8 DER. Stays on the device. */
  privateKey: string;
}

export function generateDeviceKeyPair(): DeviceKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    publicKey: (publicKey.export({ format: "der", type: "spki" }) as Buffer).toString("base64"),
    privateKey: (privateKey.export({ format: "der", type: "pkcs8" }) as Buffer).toString("base64"),
  };
}

export function importPublicKey(publicKeyB64: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(publicKeyB64, "base64"),
    format: "der",
    type: "spki",
  });
}

export function importPrivateKey(privateKeyB64: string): KeyObject {
  return createPrivateKey({
    key: Buffer.from(privateKeyB64, "base64"),
    format: "der",
    type: "pkcs8",
  });
}

/** SPKI DER bytes for a public KeyObject (used to bind wraps to a recipient). */
export function publicKeyDer(key: KeyObject): Buffer {
  return key.export({ format: "der", type: "spki" }) as Buffer;
}
