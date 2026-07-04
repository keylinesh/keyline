/**
 * Local sync state — the last bundle version this machine pushed or pulled,
 * per environment (`~/.keyline/state.json`).
 *
 * Push sends it as `baseVersion` so the server can refuse to clobber a version
 * we've never seen (someone else pushed since our last sync → 409, #22).
 * Holds no secrets — just version numbers keyed by environment id.
 */

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

interface SyncState {
  /** environmentId → last synced bundle version. */
  environments: Record<string, number>;
}

export function syncStatePath(): string {
  return join(homedir(), ".keyline", "state.json");
}

function load(path: string): SyncState {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SyncState>;
    return { environments: parsed.environments ?? {} };
  } catch {
    return { environments: {} };
  }
}

/** The last version synced for an environment, or null if never synced here. */
export function loadSyncVersion(environmentId: string, path: string = syncStatePath()): number | null {
  return load(path).environments[environmentId] ?? null;
}

export function saveSyncVersion(
  environmentId: string,
  version: number,
  path: string = syncStatePath(),
): void {
  const state = load(path);
  state.environments[environmentId] = version;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
}
