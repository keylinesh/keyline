/**
 * `keyline pull` — download the latest ciphertext bundle, decrypt it on this
 * machine (fetch-bundle.ts), and write the local .env (#32).
 *
 * The file is written 0600 and the command warns if it isn't gitignored.
 */

import { chmodSync, writeFileSync } from "node:fs";
import { countSecrets, gitignoreWarning } from "../env-file.js";
import { saveSyncVersion, syncStatePath } from "../sync-state.js";
import { fetchDecryptedBundle } from "./fetch-bundle.js";
import { resolveSyncContext, type SyncDeps, type SyncInput } from "./sync-context.js";

export interface PullResult {
  version: number;
  secretCount: number;
  envFile: string;
  label: string;
  warning: string | null;
}

export async function runPull(deps: SyncDeps, input: SyncInput): Promise<PullResult> {
  const ctx = resolveSyncContext(deps, input);
  const { plaintext, version } = await fetchDecryptedBundle(ctx);

  writeFileSync(ctx.envFile, plaintext, { mode: 0o600 });
  chmodSync(ctx.envFile, 0o600); // enforce even if the file pre-existed with looser perms
  saveSyncVersion(ctx.binding.environmentId, version, deps.statePath ?? syncStatePath());

  return {
    version,
    secretCount: countSecrets(plaintext.toString("utf8")),
    envFile: ctx.envFile,
    label: ctx.label,
    warning: gitignoreWarning(ctx.envFile),
  };
}
