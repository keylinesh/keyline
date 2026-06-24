/**
 * Dependency wiring (composition).
 *
 * memoryDeps() — all in-memory; for local dev without a database and for tests.
 * pgDeps(pool) — Postgres-backed; for staging/production.
 */

import type { Pool } from "pg";
import { DeviceLoginService } from "./auth/device-login.js";
import { TokenService } from "./auth/tokens.js";
import { AuditService } from "./domain/audit.js";
import {
  InMemoryChallengeRepo,
  InMemoryDeviceRepo,
  InMemoryTokenRepo,
} from "./auth/memory-repo.js";
import { PgChallengeRepo, PgDeviceRepo, PgTokenRepo } from "./auth/pg-repo.js";
import {
  InMemoryAuditRepo,
  InMemoryBundleRepo,
  InMemoryEnvironmentAccessRepo,
  InMemoryEnvironmentRepo,
  InMemoryMemberRepo,
  InMemoryProjectRepo,
  InMemoryWorkspaceRepo,
  InMemoryWrappedKeyRepo,
} from "./domain/memory-repo.js";
import {
  PgAuditRepo,
  PgBundleRepo,
  PgEnvironmentAccessRepo,
  PgEnvironmentRepo,
  PgMemberRepo,
  PgProjectRepo,
  PgWorkspaceRepo,
  PgWrappedKeyRepo,
} from "./domain/pg-repo.js";
import type { AppDeps } from "./http/app.js";

export function memoryDeps(): AppDeps {
  const tokens = new TokenService(new InMemoryTokenRepo());
  const login = new DeviceLoginService(
    new InMemoryDeviceRepo(),
    new InMemoryChallengeRepo(),
    tokens,
  );
  return {
    tokens,
    login,
    workspaces: new InMemoryWorkspaceRepo(),
    projects: new InMemoryProjectRepo(),
    environments: new InMemoryEnvironmentRepo(),
    bundles: new InMemoryBundleRepo(),
    wrappedKeys: new InMemoryWrappedKeyRepo(),
    members: new InMemoryMemberRepo(),
    access: new InMemoryEnvironmentAccessRepo(),
    audit: new AuditService(new InMemoryAuditRepo()),
  };
}

export function pgDeps(pool: Pool): AppDeps {
  const tokens = new TokenService(new PgTokenRepo(pool));
  const login = new DeviceLoginService(
    new PgDeviceRepo(pool),
    new PgChallengeRepo(pool),
    tokens,
  );
  return {
    tokens,
    login,
    workspaces: new PgWorkspaceRepo(pool),
    projects: new PgProjectRepo(pool),
    environments: new PgEnvironmentRepo(pool),
    bundles: new PgBundleRepo(pool),
    wrappedKeys: new PgWrappedKeyRepo(pool),
    members: new PgMemberRepo(pool),
    access: new PgEnvironmentAccessRepo(pool),
    audit: new AuditService(new PgAuditRepo(pool)),
  };
}
