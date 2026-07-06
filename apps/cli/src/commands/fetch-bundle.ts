/**
 * Fetch the latest bundle for the linked environment and decrypt it in memory —
 * shared by `pull` (writes a file, #32) and `run` (never touches disk, #33).
 *
 * The pull response carries this device's wrapped workspace key; unwrapping and
 * decryption happen only here, on the device. The plaintext stays a Buffer in
 * process memory until the caller decides what to do with it.
 */

import { openBundle, unwrapWorkspaceKey, type SealedBundle, type WrappedKey } from "@keyline/crypto";
import { ApiError } from "../api-client.js";
import { NO_ACCESS_MESSAGE } from "./workspace-key.js";
import type { SyncContext } from "./sync-context.js";

interface PullResponse {
  bundle: SealedBundle & { version: number; createdAt: string };
  wrappedKey: WrappedKey | null;
}

export interface DecryptedBundle {
  plaintext: Buffer;
  version: number;
  /** The unwrapped workspace key — needed by `rotate` to re-seal. Memory only. */
  key: Buffer;
}

export async function fetchDecryptedBundle(ctx: SyncContext): Promise<DecryptedBundle> {
  let res: PullResponse;
  try {
    res = await ctx.api.get<PullResponse>(`/v1/environments/${ctx.binding.environmentId}/bundle`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new Error(`Nothing pushed to ${ctx.label} yet. Run \`keyline push\` first.`);
    }
    throw err;
  }
  if (!res.wrappedKey) throw new Error(NO_ACCESS_MESSAGE);

  const key = unwrapWorkspaceKey(res.wrappedKey, ctx.identity.privateKey);
  try {
    const plaintext = openBundle(
      { v: res.bundle.v, nonce: res.bundle.nonce, ciphertext: res.bundle.ciphertext, tag: res.bundle.tag },
      key,
    );
    return { plaintext, version: res.bundle.version, key };
  } catch {
    throw new Error(
      "Could not decrypt the bundle with this device's key. " +
        "If the workspace key was rotated, ask an admin to re-grant this device.",
    );
  }
}
