/**
 * CLI configuration.
 *
 * Two layers:
 *   - global config (`~/.keyline/config.json`): the API base URL.
 *   - project binding (`.keyline.json` in a directory, found by walking up):
 *     which workspace/project/environment this directory is linked to (`link`).
 *
 * Neither file holds secrets — credentials live in the OS keychain
 * (credentials.ts). The API URL can be overridden with KEYLINE_API_URL.
 */

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export const DEFAULT_API_BASE_URL = "https://keyline.sh/api";
export const PROJECT_CONFIG_NAME = ".keyline.json";

export interface GlobalConfig {
  apiBaseUrl: string;
}

export function globalConfigPath(): string {
  return join(homedir(), ".keyline", "config.json");
}

export function loadGlobalConfig(path: string = globalConfigPath()): GlobalConfig {
  let parsed: Partial<GlobalConfig> = {};
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    /* missing or invalid → defaults */
  }
  return {
    apiBaseUrl: process.env.KEYLINE_API_URL ?? parsed.apiBaseUrl ?? DEFAULT_API_BASE_URL,
  };
}

export function saveGlobalConfig(config: GlobalConfig, path: string = globalConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export interface ProjectConfig {
  workspaceId: string;
  projectId: string;
  environmentId: string;
  /** Friendly labels for output; ids are authoritative. */
  projectSlug?: string;
  environmentName?: string;
}

/** Walk up from `startDir` looking for a `.keyline.json` binding. */
export function findProjectConfig(
  startDir: string = process.cwd(),
): { config: ProjectConfig; path: string } | null {
  let dir = startDir;
  for (;;) {
    const path = join(dir, PROJECT_CONFIG_NAME);
    if (existsSync(path)) {
      try {
        return { config: JSON.parse(readFileSync(path, "utf8")), path };
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function saveProjectConfig(config: ProjectConfig, dir: string = process.cwd()): string {
  const path = join(dir, PROJECT_CONFIG_NAME);
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
  return path;
}
