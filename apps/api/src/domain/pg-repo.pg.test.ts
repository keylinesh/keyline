/**
 * Postgres integration tests. Skipped unless DATABASE_URL is set, so the normal
 * test run (no DB) is unaffected; CI runs these against a postgres service.
 *
 * Exercises the transactional pg paths the in-memory repos can't reproduce —
 * notably bundle version locking and the audit hash-chain. (A regression here —
 * `FOR UPDATE` with an aggregate — only ever showed up against real Postgres.)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { connectionConfig } from "../db/connection.js";
import { migrate } from "../db/migrate.js";
import {
  PgWorkspaceRepo,
  PgProjectRepo,
  PgEnvironmentRepo,
  PgBundleRepo,
  PgAuditRepo,
} from "./pg-repo.js";
import { VersionConflictError } from "./bundles.js";
import { verifyChain } from "./audit.js";

const run = !!process.env.DATABASE_URL;

test("pg repos round-trip against Postgres", { skip: !run }, async () => {
  await migrate(); // idempotent — ensure schema exists
  const pool = new Pool(connectionConfig(process.env.DATABASE_URL!));
  const ws = new PgWorkspaceRepo(pool);
  const pr = new PgProjectRepo(pool);
  const en = new PgEnvironmentRepo(pool);
  const bn = new PgBundleRepo(pool);
  const au = new PgAuditRepo(pool);
  try {
    const w = await ws.create({ name: "pgtest", kdfSalt: "c2FsdA==" });
    const p = await pr.create({ workspaceId: w.id, name: "api", slug: "api" });
    const e = await en.create({ projectId: p.id, name: "prod" });

    const b1 = await bn.append({
      environmentId: e.id, formatVersion: 1, nonce: "n", ciphertext: "c1", tag: "t", createdByDeviceId: null,
    });
    const b2 = await bn.append({
      environmentId: e.id, baseVersion: 1, formatVersion: 1, nonce: "n", ciphertext: "c2", tag: "t", createdByDeviceId: null,
    });
    assert.equal(b1.version, 1);
    assert.equal(b2.version, 2);

    // stale baseVersion -> conflict (optimistic concurrency over real Postgres)
    await assert.rejects(
      () => bn.append({ environmentId: e.id, baseVersion: 1, formatVersion: 1, nonce: "n", ciphertext: "x", tag: "t", createdByDeviceId: null }),
      VersionConflictError,
    );
    assert.equal((await bn.getLatest(e.id))!.version, 2);

    await au.append({ workspaceId: w.id, action: "a", outcome: "allowed" });
    await au.append({ workspaceId: w.id, action: "b", outcome: "denied", metadata: { reason: "x" } });
    assert.deepEqual(verifyChain(await au.list(w.id)), { ok: true, count: 2 });

    assert.ok(await ws.delete(w.id)); // cascade removes children + audit
  } finally {
    await pool.end();
  }
});
