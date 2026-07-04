/**
 * `keyline pull` — download the latest ciphertext bundle, decrypt it on this
 * machine, and write the local .env (#32).
 *
 * The pull response carries this device's wrapped workspace key; unwrapping and
 * decryption happen only here. The file is written 0600 and the command warns
 * if it isn't gitignored.
 */

import { chmodSync, writeFileSync } from "node:fs";
import { openBundle, unwrapWorkspaceKey, type SealedBundle, type WrappedKey } from "@keyline/crypto";
import { ApiError } from "../api-client.js";
import { countSecrets, gitignoreWarning } from "../env-file.js";
import { saveSyncVersion, syncStatePath } from "../sync-state.js";
import { NO_ACCESS_MESSAGE } from "./workspace-key.js";
import { resolveSyncContext, type SyncDeps, type SyncInput } from "./sync-context.js";

export interface PullResult {
  version: number;
  secretCount: number;
  envFile: string;
  label: string;
  warning: string | null;
}

interface PullResponse {
  bundle: SealedBundle & { version: number; createdAt: string };
  wrappedKey: WrappedKey | null;
}

export async function runPull(deps: SyncDeps, input: SyncInput): Promise<PullResult> {
  const ctx = resolveSyncContext(deps, input);

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
  let plaintext: Buffer;
  try {
    plaintext = openBundle(
      { v: res.bundle.v, nonce: res.bundle.nonce, ciphertext: res.bundle.ciphertext, tag: res.bundle.tag },
      key,
    );
  } catch {
    throw new Error(
      "Could not decrypt the bundle with this device's key. " +
        "If the workspace key was rotated, ask an admin to re-grant this device.",
    );
  }

  writeFileSync(ctx.envFile, plaintext, { mode: 0o600 });
  chmodSync(ctx.envFile, 0o600); // enforce even if the file pre-existed with looser perms
  saveSyncVersion(ctx.binding.environmentId, res.bundle.version, deps.statePath ?? syncStatePath());

  const content = plaintext.toString("utf8");
  return {
    version: res.bundle.version,
    secretCount: countSecrets(content),
    envFile: ctx.envFile,
    label: ctx.label,
    warning: gitignoreWarning(ctx.envFile),
  };
}
