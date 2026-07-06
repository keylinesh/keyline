/**
 * `keyline rotate <KEY>` — replace one secret's value (#34).
 *
 * The client does all the crypto: fetch + decrypt the bundle in memory, swap
 * the one value (preserving every other byte of the file), re-seal, and push
 * the new version through the rotate endpoint — which audits the secret NAME,
 * never the value. If the local .env exists it is rewritten to match, so the
 * working copy doesn't go stale.
 *
 * Concurrency: the fetched version is sent as baseVersion, so a rotate can
 * never silently drop a push that landed in between (409 instead).
 */

import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { sealBundle } from "@keyline/crypto";
import { ApiError } from "../api-client.js";
import { ENV_KEY_PATTERN, replaceEnvValue } from "../env-file.js";
import { saveSyncVersion, syncStatePath } from "../sync-state.js";
import { fetchDecryptedBundle } from "./fetch-bundle.js";
import { resolveSyncContext, type SyncDeps, type SyncInput } from "./sync-context.js";

export interface RotateInput extends SyncInput {
  name: string;
  value: string;
}

export interface RotateResult {
  version: number;
  name: string;
  label: string;
  /** Path of the local .env rewritten to match, or null if none existed. */
  envFileUpdated: string | null;
}

interface RotateResponse {
  version: number;
  createdAt: string;
}

export async function runRotate(deps: SyncDeps, input: RotateInput): Promise<RotateResult> {
  if (!ENV_KEY_PATTERN.test(input.name)) {
    throw new Error(`invalid secret name: ${JSON.stringify(input.name)}`);
  }
  const ctx = resolveSyncContext(deps, input);
  const { plaintext, version, key } = await fetchDecryptedBundle(ctx);

  const updated = replaceEnvValue(plaintext.toString("utf8"), input.name, input.value);
  if (updated === null) {
    throw new Error(
      `${input.name} is not in ${ctx.label}. To add a new secret, put it in your .env and \`keyline push\`.`,
    );
  }

  const bundle = sealBundle(updated, key);
  let rotated: RotateResponse;
  try {
    rotated = await ctx.api.post<RotateResponse>(
      `/v1/environments/${ctx.binding.environmentId}/rotate`,
      { bundle, baseVersion: version, secretName: input.name },
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      throw new Error(
        `Someone pushed to ${ctx.label} while rotating. Run \`keyline pull\` and retry.`,
      );
    }
    throw err;
  }

  saveSyncVersion(ctx.binding.environmentId, rotated.version, deps.statePath ?? syncStatePath());

  let envFileUpdated: string | null = null;
  if (existsSync(ctx.envFile)) {
    writeFileSync(ctx.envFile, updated, { mode: 0o600 });
    chmodSync(ctx.envFile, 0o600);
    envFileUpdated = ctx.envFile;
  }

  return { version: rotated.version, name: input.name, label: ctx.label, envFileUpdated };
}
