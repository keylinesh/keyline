/**
 * Device identity — generated once per device on first login.
 *
 * On first login the device generates an X25519 keypair (see @keyline/crypto),
 * persists it in the local key store, and registers only its PUBLIC key with the
 * server. The private key never leaves the device.
 *
 * See docs/encryption-design.md §3.
 */

import { randomUUID } from "node:crypto";
import { generateDeviceKeyPair } from "@keyline/crypto";
import type { KeyStore } from "./keystore.js";

/** Keystore account under which the serialized identity is stored. */
const IDENTITY_ACCOUNT = "device-identity";

export interface DeviceIdentity {
  /** Stable id for this device, generated at first login. */
  deviceId: string;
  /** base64 SPKI DER. Registered with the server. */
  publicKey: string;
  /** base64 PKCS8 DER. Stays on the device — never sent anywhere. */
  privateKey: string;
}

/** The non-secret subset of an identity that is safe to send to the server. */
export interface DeviceRegistration {
  deviceId: string;
  publicKey: string;
}

function isIdentity(value: unknown): value is DeviceIdentity {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.deviceId === "string" &&
    typeof v.publicKey === "string" &&
    typeof v.privateKey === "string"
  );
}

/**
 * Load the device identity from the store, generating and persisting a new one
 * on first login. Idempotent: subsequent calls return the same identity.
 */
export function loadOrCreateDeviceIdentity(store: KeyStore): {
  identity: DeviceIdentity;
  created: boolean;
} {
  const existing = store.get(IDENTITY_ACCOUNT);
  if (existing) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch {
      throw new Error(
        "stored device identity is corrupt; re-run `keyline login --reset`",
      );
    }
    if (!isIdentity(parsed)) {
      throw new Error(
        "stored device identity is missing fields; re-run `keyline login --reset`",
      );
    }
    return { identity: parsed, created: false };
  }

  const keypair = generateDeviceKeyPair();
  const identity: DeviceIdentity = {
    deviceId: randomUUID(),
    publicKey: keypair.publicKey,
    privateKey: keypair.privateKey,
  };
  store.set(IDENTITY_ACCOUNT, JSON.stringify(identity));
  return { identity, created: true };
}

/** Forget the local device identity (e.g. on logout or reset). */
export function clearDeviceIdentity(store: KeyStore): void {
  store.delete(IDENTITY_ACCOUNT);
}

/** Only the public material — never include the private key when registering. */
export function registrationOf(identity: DeviceIdentity): DeviceRegistration {
  return { deviceId: identity.deviceId, publicKey: identity.publicKey };
}

/** A transport sends the public registration to the server. */
export type RegisterTransport = (
  reg: DeviceRegistration,
) => void | Promise<void>;

/**
 * Register this device's public key with the server.
 *
 * The transport receives only {deviceId, publicKey}; the private key is never
 * passed in. The default HTTP transport is below — the server-side endpoint
 * lands in milestone M2.
 */
export async function registerDevice(
  identity: DeviceIdentity,
  transport: RegisterTransport,
): Promise<void> {
  await transport(registrationOf(identity));
}

/** Default transport: POST the public registration to the keyline API. */
export function httpRegisterTransport(
  baseUrl: string,
  token: string,
): RegisterTransport {
  return async (reg) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/devices`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(reg),
    });
    if (!res.ok) {
      throw new Error(
        `device registration failed: ${res.status} ${res.statusText}`,
      );
    }
  };
}
