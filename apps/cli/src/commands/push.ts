/**
 * `keyline push` — encrypt the local .env on this machine and upload only the
 * ciphertext (#32). The server never sees plaintext or the workspace key.
 *
 * Concurrency: sends the last version this machine synced as `baseVersion`. If
 * someone pushed since, the server answers 409 and nothing is clobbered; the
 * user pulls first (or forces). First push in a fresh workspace also generates
 * the workspace key (see workspace-key.ts).
 */

import { readFileSync } from "node:fs";
import { sealBundle } from "@keyline/crypto";
import { ApiError } from "../api-client.js";
import { countSecrets, gitignoreWarning } from "../env-file.js";
import { loadSyncVersion, saveSyncVersion, syncStatePath } from "../sync-state.js";
import { obtainWorkspaceKey } from "./workspace-key.js";
import { resolveSyncContext, type SyncDeps, type SyncInput } from "./sync-context.js";

export interface PushInput extends SyncInput {
  /** Overwrite whatever the server has, skipping the version check. */
  force?: boolean;
}

export interface PushResult {
  version: number;
  secretCount: number;
  envFile: string;
  label: string;
  /** True when this push created the workspace key (first push ever). */
  bootstrappedKey: boolean;
  /** Set when the .env is in a git repo but not gitignored. */
  warning: string | null;
}

interface PushResponse {
  version: number;
  createdAt: string;
}

export async function runPush(deps: SyncDeps, input: PushInput): Promise<PushResult> {
  const ctx = resolveSyncContext(deps, input);
  const statePath = deps.statePath ?? syncStatePath();

  let content: string;
  try {
    content = readFileSync(ctx.envFile, "utf8");
  } catch {
    throw new Error(`No env file at ${ctx.envFile}. Create it, or point at one with --file.`);
  }

  const { key, bootstrapped } = await obtainWorkspaceKey(ctx.api, ctx.account.deviceId, ctx.identity);
  const bundle = sealBundle(content, key);

  const envId = ctx.binding.environmentId;
  const baseVersion = input.force ? undefined : (loadSyncVersion(envId, statePath) ?? 0);
  let pushed: PushResponse;
  try {
    pushed = await ctx.api.put<PushResponse>(`/v1/environments/${envId}/bundle`, {
      bundle,
      baseVersion,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const current = (err.details as { currentVersion?: number } | undefined)?.currentVersion;
      throw new Error(
        `Someone pushed to ${ctx.label} since your last sync` +
          (current !== undefined ? ` (server is at version ${current})` : "") +
          ". Run `keyline pull` first, or `keyline push --force` to overwrite.",
      );
    }
    throw err;
  }

  saveSyncVersion(envId, pushed.version, statePath);
  return {
    version: pushed.version,
    secretCount: countSecrets(content),
    envFile: ctx.envFile,
    label: ctx.label,
    bootstrappedKey: bootstrapped,
    warning: gitignoreWarning(ctx.envFile),
  };
}
