/**
 * Shared test plumbing: an in-memory KeyStore and a CLI deps object wired to a
 * fresh in-memory API instance (buildApp) in a linked temp directory. Used by
 * the command integration tests; not part of the shipped CLI.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp, memoryDeps } from "@keyline/api/app";
import { loadAccount } from "./account.js";
import type { KeyStore } from "./keystore.js";
import { runLogin } from "./commands/login.js";
import { runLink } from "./commands/link.js";

export const TEST_ENV =
  "API_KEY=sk_live_x\n# a comment survives round-trips\nDB_URL=postgres://localhost/app\n";

export function memStore(): KeyStore {
  const map = new Map<string, string>();
  return {
    backend: "memory",
    get: (a) => map.get(a) ?? null,
    set: (a, s) => void map.set(a, s),
    delete: (a) => void map.delete(a),
  };
}

export interface Harness {
  deps: {
    store: KeyStore;
    apiBaseUrl: string;
    fetchImpl: typeof fetch;
    statePath: string;
  };
  dir: string;
  fetchImpl: typeof fetch;
  cleanup: () => void;
}

/** Logged-in + linked CLI deps against a fresh in-memory API, with an .env. */
export async function harness(): Promise<Harness> {
  const apiDeps = memoryDeps();
  const app = buildApp(apiDeps);
  const fetchImpl = ((url: string, init?: RequestInit) =>
    app.request(url, init)) as unknown as typeof fetch;
  const dir = mkdtempSync(join(tmpdir(), "keyline-sync-"));
  const deps = {
    store: memStore(),
    apiBaseUrl: "",
    fetchImpl,
    statePath: join(dir, "state.json"),
  };
  await runLogin(deps, { workspaceName: "Acme", email: "founder@acme.test" });
  await runLink(deps, { project: "api", environment: "prod", dir });
  // Team plan: these tests exercise invites and audit history, which solo's
  // entitlements (1 member, 7-day audit window) would block (#49).
  const account = loadAccount(deps.store)!;
  await apiDeps.workspaces.update(account.workspaceId, { plan: "team" });
  writeFileSync(join(dir, ".env"), TEST_ENV);
  return { deps, dir, fetchImpl, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
