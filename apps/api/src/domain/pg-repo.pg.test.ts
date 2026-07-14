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
import { appDatabaseUrl } from "../db/database-url.js";
import { migrate } from "../db/migrate.js";
import {
  PgWorkspaceRepo,
  PgProjectRepo,
  PgEnvironmentRepo,
  PgBundleRepo,
  PgAuditRepo,
  PgMemberRepo,
  PgWebSessionRepo,
  PgWrappedKeyRepo,
} from "./pg-repo.js";
import { PgDeviceRepo } from "../auth/pg-repo.js";
import { PgSubscriptionRepo } from "../billing/subscriptions.js";
import { hashSessionCode } from "./web-sessions.js";
import { VersionConflictError } from "./bundles.js";
import { verifyChain } from "./audit.js";

const dbUrl = appDatabaseUrl();

test("pg repos round-trip against Postgres", { skip: !dbUrl }, async () => {
  await migrate(); // idempotent — ensure schema exists
  const pool = new Pool(connectionConfig(dbUrl!));
  const ws = new PgWorkspaceRepo(pool);
  const pr = new PgProjectRepo(pool);
  const en = new PgEnvironmentRepo(pool);
  const bn = new PgBundleRepo(pool);
  const au = new PgAuditRepo(pool);
  try {
    const w = await ws.create({ name: "pgtest", kdfSalt: "c2FsdA==" });
    assert.equal(w.plan, "solo", "workspaces default to the solo plan (#49)");
    assert.equal((await ws.update(w.id, { plan: "team" }))?.plan, "team");
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

    // wrapped keys: existsForWorkspace distinguishes fresh workspace vs granted (#32)
    const wk = new PgWrappedKeyRepo(pool);
    assert.equal(await wk.existsForWorkspace(w.id), false);
    const member = await new PgMemberRepo(pool).create({
      workspaceId: w.id, email: "pg@test", role: "owner",
    });
    const device = await new PgDeviceRepo(pool).register({
      memberId: member.id, workspaceId: w.id, publicKey: "pk", role: "owner",
    });
    await wk.upsert({
      workspaceId: w.id, deviceId: device.id, formatVersion: 1, eph: "e", nonce: "n", ct: "c", tag: "t",
    });
    assert.equal(await wk.existsForWorkspace(w.id), true);
    assert.equal((await wk.findForDevice(w.id, device.id))?.ct, "c");

    // web sessions (#39): pending -> approved -> claimed exactly once
    const wsess = new PgWebSessionRepo(pool);
    const session = await wsess.create({
      codeHash: hashSessionCode("TEST-CODE"),
      expiresAt: new Date(Date.now() + 60_000),
    });
    assert.equal(session.status, "pending");
    assert.equal((await wsess.findByCodeHash(hashSessionCode("test code")))?.id, session.id);
    assert.equal(
      await wsess.approve(session.id, { memberId: member.id, deviceId: device.id, workspaceId: w.id, role: "owner" }, new Date()),
      true,
    );
    assert.equal(await wsess.approve(session.id, { memberId: member.id, deviceId: device.id, workspaceId: w.id, role: "owner" }, new Date()), false, "approve is single-shot");
    const claimed = await wsess.claim(session.id);
    assert.equal(claimed?.memberId, member.id);
    assert.equal(await wsess.claim(session.id), null, "claim is single-shot");

    await au.append({ workspaceId: w.id, action: "a", outcome: "allowed" });
    await au.append({ workspaceId: w.id, action: "b", outcome: "denied", metadata: { reason: "x" } });
    assert.deepEqual(verifyChain(await au.list(w.id)), { ok: true, count: 2 });

    // Subscription state machine (#74). The CASE branch for past_due_since
    // needs an explicit ::timestamptz cast — without it pg infers text and the
    // insert throws. This bit us in production; memory tests can't catch it.
    const subs = new PgSubscriptionRepo(pool);
    const t1 = new Date("2026-07-14T12:00:00Z");
    const first = await subs.upsertIfNewer({
      workspaceId: w.id, paddleSubscriptionId: "sub_pg", paddleCustomerId: "ctm_pg",
      status: "trialing", currentPeriodEnd: new Date("2026-07-28T00:00:00Z"), occurredAt: t1,
    });
    assert.equal(first?.status, "trialing");
    const newer = await subs.upsertIfNewer({
      workspaceId: w.id, paddleSubscriptionId: "sub_pg", paddleCustomerId: null,
      status: "past_due", currentPeriodEnd: null, occurredAt: new Date("2026-07-14T13:00:00Z"),
    });
    assert.equal(newer?.status, "past_due");
    assert.equal(newer?.pastDueSince?.toISOString(), "2026-07-14T13:00:00.000Z");
    assert.equal(newer?.paddleCustomerId, "ctm_pg", "customer id survives null updates");
    const stale = await subs.upsertIfNewer({
      workspaceId: w.id, paddleSubscriptionId: "sub_pg", paddleCustomerId: null,
      status: "active", currentPeriodEnd: null, occurredAt: t1,
    });
    assert.equal(stale, null, "older event ignored");
    assert.equal((await subs.findByWorkspace(w.id))?.status, "past_due");

    assert.ok(await ws.delete(w.id)); // cascade removes children + audit
  } finally {
    await pool.end();
  }
});
