import { test } from "node:test";
import assert from "node:assert/strict";
import { AuditService, verifyChain, computeEventHash, GENESIS_HASH } from "./audit.js";
import { InMemoryAuditRepo } from "./memory-repo.js";

function service() {
  return new AuditService(new InMemoryAuditRepo());
}

test("first event chains from genesis; each event chains to the previous", async () => {
  const audit = service();
  const a = await audit.record({ workspaceId: "w1", action: "x", outcome: "allowed" });
  const b = await audit.record({ workspaceId: "w1", action: "y", outcome: "allowed" });
  assert.equal(a.seq, 1);
  assert.equal(a.prevHash, GENESIS_HASH);
  assert.equal(b.seq, 2);
  assert.equal(b.prevHash, a.hash);
});

test("chains are independent per workspace", async () => {
  const audit = service();
  const a = await audit.record({ workspaceId: "w1", action: "x", outcome: "allowed" });
  const b = await audit.record({ workspaceId: "w2", action: "x", outcome: "allowed" });
  assert.equal(a.seq, 1);
  assert.equal(b.seq, 1);
  assert.equal(b.prevHash, GENESIS_HASH);
});

test("verify passes on an untouched chain", async () => {
  const audit = service();
  for (let i = 0; i < 5; i++) {
    await audit.record({ workspaceId: "w1", action: `a${i}`, outcome: "allowed" });
  }
  const result = await audit.verify("w1");
  assert.deepEqual(result, { ok: true, count: 5 });
});

test("verify detects a tampered event payload", async () => {
  const repo = new InMemoryAuditRepo();
  const audit = new AuditService(repo);
  await audit.record({ workspaceId: "w1", action: "first", outcome: "allowed" });
  await audit.record({ workspaceId: "w1", action: "second", outcome: "allowed" });
  await audit.record({ workspaceId: "w1", action: "third", outcome: "allowed" });

  // Tamper: flip the action of event #2 (hash no longer matches its contents).
  const events = await repo.list("w1");
  events[1]!.action = "TAMPERED";

  const result = verifyChain(events);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.brokenSeq, 2);
});

test("verify detects a deleted event (sequence gap / broken link)", async () => {
  const repo = new InMemoryAuditRepo();
  const audit = new AuditService(repo);
  await audit.record({ workspaceId: "w1", action: "a", outcome: "allowed" });
  await audit.record({ workspaceId: "w1", action: "b", outcome: "allowed" });
  await audit.record({ workspaceId: "w1", action: "c", outcome: "allowed" });

  const events = await repo.list("w1");
  const withHole = [events[0]!, events[2]!]; // drop the middle event

  const result = verifyChain(withHole);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.brokenSeq, 3);
});

test("recomputing a tampered event's own hash still breaks the next link", async () => {
  const repo = new InMemoryAuditRepo();
  const audit = new AuditService(repo);
  await audit.record({ workspaceId: "w1", action: "a", outcome: "allowed" });
  await audit.record({ workspaceId: "w1", action: "b", outcome: "allowed" });
  await audit.record({ workspaceId: "w1", action: "c", outcome: "allowed" });
  const events = await repo.list("w1");

  // Attacker rewrites event #2 and recomputes its hash so it is self-consistent.
  events[1]!.action = "forged";
  events[1]!.hash = computeEventHash(events[1]!);

  // Event #3 still commits to the ORIGINAL hash of #2, so the link breaks there.
  // (Fully forging would require rewriting every later event — which is why the
  // chain head should also be witnessed externally; tracked for #29/launch.)
  const result = verifyChain(events);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.brokenSeq, 3);
});
