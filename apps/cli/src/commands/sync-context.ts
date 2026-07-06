/**
 * Shared setup for push/pull (#32): a valid session, the device identity, the
 * directory's project binding, and the resolved .env path.
 */

import { isAbsolute, join, resolve } from "node:path";
import { ApiClient } from "../api-client.js";
import type { KeyStore } from "../keystore.js";
import { loadAccount, type StoredAccount } from "../account.js";
import { type DeviceIdentity, loadDeviceIdentity } from "../device.js";
import { isCredentialValid, loadCredentials } from "../credentials.js";
import { findProjectConfig, type ProjectConfig } from "../config.js";
import { DEFAULT_ENV_FILE } from "../env-file.js";

export interface SyncDeps {
  apiBaseUrl: string;
  store: KeyStore;
  fetchImpl?: typeof fetch;
  /** Override the sync-state file location (tests). */
  statePath?: string;
}

export interface SyncInput {
  /** .env path; relative paths resolve against the linked directory. */
  file?: string;
  /** Directory to resolve the binding from (defaults to cwd). */
  dir?: string;
}

export interface Session {
  api: ApiClient;
  account: StoredAccount;
  identity: DeviceIdentity;
}

export interface SyncContext extends Session {
  binding: ProjectConfig;
  /** Absolute path of the local .env to read (push) or write (pull). */
  envFile: string;
  /** Friendly "project/env" label for messages. */
  label: string;
}

/** A valid login + device identity — enough for workspace-level commands. */
export function resolveSession(deps: SyncDeps): Session {
  const creds = loadCredentials(deps.store);
  if (!isCredentialValid(creds)) {
    throw new Error("Not logged in. Run `keyline login` first.");
  }
  const account = loadAccount(deps.store);
  const identity = loadDeviceIdentity(deps.store);
  if (!account || !identity) {
    throw new Error("No account on this device. Run `keyline login` first.");
  }
  return {
    api: new ApiClient({ baseUrl: deps.apiBaseUrl, token: creds.token, fetchImpl: deps.fetchImpl }),
    account,
    identity,
  };
}

export function resolveSyncContext(deps: SyncDeps, input: SyncInput): SyncContext {
  const session = resolveSession(deps);

  const found = findProjectConfig(input.dir);
  if (!found) {
    throw new Error("This directory is not linked. Run `keyline link <project> --env <env>` first.");
  }
  const { config: binding, path } = found;
  const linkedDir = resolve(path, "..");
  const envFile = input.file
    ? isAbsolute(input.file)
      ? input.file
      : join(linkedDir, input.file)
    : join(linkedDir, DEFAULT_ENV_FILE);

  return {
    ...session,
    binding,
    envFile,
    label: `${binding.projectSlug ?? binding.projectId}/${binding.environmentName ?? binding.environmentId}`,
  };
}
