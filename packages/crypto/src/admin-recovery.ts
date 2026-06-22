/**
 * Admin-device recovery flow.
 *
 * When a member loses their device, any active admin device can restore the
 * member's access by re-wrapping the workspace key to the member's new device.
 * This builds the end-to-end flow on top of the `rewrapWorkspaceKey` primitive
 * (envelope.ts) and gives clear, actionable errors when recovery isn't possible.
 *
 *   1. Find an active admin device for the workspace (selectRecoveryAdmin).
 *   2. On that admin's machine, unwrap the workspace key and re-wrap it to the
 *      new device's public key (recoverToNewDevice).
 *   3. The new wrapped key is stored server-side against the new device; the
 *      member can now unwrap it locally.
 *
 * The server never sees the workspace key during any of this — only wrapped
 * keys move across the wire. See docs/encryption-design.md §5.
 */

import { type WrappedKey, rewrapWorkspaceKey } from "./envelope.js";

/** No active admin device exists, so admin recovery cannot proceed. */
export class NoAdminDeviceAvailableError extends Error {
  constructor() {
    super(
      "Recovery is not possible: this workspace has no active admin device. " +
        "Ask a workspace admin to sign in on an active device, then retry — " +
        "or restore from a sealed recovery file if you have one.",
    );
    this.name = "NoAdminDeviceAvailableError";
  }
}

/** The admin device could not complete the re-wrap (no access, or corrupt input). */
export class AdminRecoveryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AdminRecoveryError";
  }
}

/** Minimal view of an admin device the recovery flow needs to choose one. */
export interface AdminDeviceRef {
  deviceId: string;
  /** false once the device has been revoked. */
  active: boolean;
}

/**
 * Choose an active admin device to perform recovery.
 * Throws {@link NoAdminDeviceAvailableError} with a clear message if none exist.
 */
export function selectRecoveryAdmin<T extends AdminDeviceRef>(
  adminDevices: readonly T[],
): T {
  const firstActive = adminDevices.find((d) => d.active);
  if (!firstActive) throw new NoAdminDeviceAvailableError();
  return firstActive;
}

export interface AdminRecoveryRequest {
  /** The admin's own wrapped copy of the workspace key. */
  adminWrappedKey: WrappedKey;
  /** The admin device's private key (base64 PKCS8 DER) — stays on the admin's machine. */
  adminPrivateKey: string;
  /** The new device's public key (base64 SPKI DER) to grant access to. */
  newDevicePublicKey: string;
}

/**
 * Run on the admin's device: unwrap the workspace key and re-wrap it to the new
 * device. Returns the new device's WrappedKey. Wraps low-level crypto failures
 * in an {@link AdminRecoveryError} with an actionable message.
 */
export function recoverToNewDevice(req: AdminRecoveryRequest): WrappedKey {
  try {
    return rewrapWorkspaceKey(
      req.adminWrappedKey,
      req.adminPrivateKey,
      req.newDevicePublicKey,
    );
  } catch (cause) {
    throw new AdminRecoveryError(
      "Admin recovery failed: this admin device could not unwrap the workspace " +
        "key. The device may no longer have access, or the wrapped key is corrupt.",
      { cause },
    );
  }
}
