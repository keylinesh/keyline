/**
 * Workspace key acquisition for push/pull (#32).
 *
 * The 32-byte workspace key encrypts every bundle in the workspace. It exists
 * only client-side; the server stores it wrapped (sealed) to each device's
 * public key. Getting it on this device:
 *
 *   1. The server has a wrapped key for this device → unwrap with the device
 *      private key.
 *   2. No key anywhere in the workspace (fresh workspace) → generate one,
 *      wrap it to our own public key, upload the blob, use it.
 *   3. The workspace has a key but this device wasn't granted one → error;
 *      an admin device must re-wrap it to us (issue flow, #23/#35).
 *
 * The unwrapped key lives only in process memory — never written to disk.
 */

import {
  generateWorkspaceKey,
  unwrapWorkspaceKey,
  wrapWorkspaceKey,
  type WrappedKey,
} from "@keyline/crypto";
import type { ApiClient } from "../api-client.js";
import type { DeviceIdentity } from "../device.js";

export const NO_ACCESS_MESSAGE =
  "This device has no key to the workspace yet. Ask a workspace admin to grant it access.";

interface WrappedKeyResponse {
  wrappedKey: WrappedKey | null;
  workspaceHasKey: boolean;
}

export interface ObtainedKey {
  key: Buffer;
  /** True when this call created the workspace key (first push in a fresh workspace). */
  bootstrapped: boolean;
}

export async function obtainWorkspaceKey(
  api: ApiClient,
  serverDeviceId: string,
  identity: DeviceIdentity,
): Promise<ObtainedKey> {
  const res = await api.get<WrappedKeyResponse>(`/v1/devices/${serverDeviceId}/wrapped-key`);
  if (res.wrappedKey) {
    return { key: unwrapWorkspaceKey(res.wrappedKey, identity.privateKey), bootstrapped: false };
  }
  if (res.workspaceHasKey) throw new Error(NO_ACCESS_MESSAGE);

  const key = generateWorkspaceKey();
  const wrappedKey = wrapWorkspaceKey(key, identity.publicKey);
  await api.put(`/v1/devices/${serverDeviceId}/wrapped-key`, { wrappedKey });
  return { key, bootstrapped: true };
}
