import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { AnchorService, InMemoryAnchorRepo, hashedWorkspaceKey } from "./anchors.js";
import { AuditService } from "./audit.js";
import { InMemoryAuditRepo } from "./memory-repo.js";

async function seed(repo: InMemoryAuditRepo, workspaceId: string, actions: string[]) {
  for (const action of actions) {
    await repo.append({ workspaceId, action, outcome: "allowed" });
  }
}

function fakeWitness() {
  const published: Array<{ fileName: string; content: string }> = [];
  return {
    published,
    publish: async (fileName: string, content: string) => {
      published.push({ fileName, content });
      return `https://witness.example/${fileName}`;
    },
  };
}

test("anchoring witnesses every chain head under a privacy-hashed key", async () => {
  const audit = new InMemoryAuditRepo();
  await seed(audit, "ws-1", ["a", "b", "c"]);
  await seed(audit, "ws-2", ["x"]);
  const anchors = new InMemoryAnchorRepo();
  const witness = fakeWitness();

  const report = await new AnchorService(audit, anchors, witness).run(new Date("2026-07-15T06:30:00Z"));
  assert.equal(report.workspaces, 2);
  assert.equal(report.witnessUrl, "https://witness.example/2026-07-15.json");

  const payload = JSON.parse(witness.published[0]!.content);
  const key1 = hashedWorkspaceKey("ws-1");
  assert.equal(payload.anchors[key1].seq, 3);
  assert.ok(!JSON.stringify(payload).includes("ws-1"), "raw workspace ids never published");
  assert.equal(key1, createHash("sha256").update("ws-1").digest("hex"));

  const local = await anchors.latestForWorkspace("ws-1");
  assert.equal(local?.seq, 3);
  assert.equal(local?.witnessUrl, report.witnessUrl);
});

test("verify reports the anchor as matching while history is intact", async () => {
  const audit = new InMemoryAuditRepo();
  await seed(audit, "ws-1", ["a", "b"]);
  const anchors = new InMemoryAnchorRepo();
  await new AnchorService(audit, anchors, null).run();

  // New events after the anchor are fine: the anchored prefix still matches.
  await seed(audit, "ws-1", ["c"]);
  const result = await new AuditService(audit, anchors).verify("ws-1");
  assert.equal(result.ok, true);
  assert.equal(result.anchor?.seq, 2);
  assert.equal(result.anchor?.matches, true);
});

test("a full-chain rewrite passes verifyChain but FAILS the anchor check", async () => {
  const original = new InMemoryAuditRepo();
  await seed(original, "ws-1", ["a", "b", "c"]);
  const anchors = new InMemoryAnchorRepo();
  await new AnchorService(original, anchors, null).run();

  // The attacker rewrites history wholesale: a fresh, internally consistent
  // chain with different content. Chain verification alone cannot see it.
  const rewritten = new InMemoryAuditRepo();
  await seed(rewritten, "ws-1", ["a", "TAMPERED", "c"]);

  const result = await new AuditService(rewritten, anchors).verify("ws-1");
  assert.equal(result.ok, true, "the rewritten chain is internally consistent");
  assert.equal(result.anchor?.matches, false, "but it no longer matches the public witness");
});

test("a truncated chain fails the anchor check too", async () => {
  const original = new InMemoryAuditRepo();
  await seed(original, "ws-1", ["a", "b", "c"]);
  const anchors = new InMemoryAnchorRepo();
  await new AnchorService(original, anchors, null).run();

  const truncated = new InMemoryAuditRepo();
  await seed(truncated, "ws-1", ["a", "b"]);
  const result = await new AuditService(truncated, anchors).verify("ws-1");
  assert.equal(result.anchor?.matches, false);
});

test("without a witness the run still records local anchors (no URL)", async () => {
  const audit = new InMemoryAuditRepo();
  await seed(audit, "ws-1", ["a"]);
  const anchors = new InMemoryAnchorRepo();
  const report = await new AnchorService(audit, anchors, null).run();
  assert.equal(report.workspaces, 1);
  assert.equal(report.witnessUrl, null);
  assert.equal((await anchors.latestForWorkspace("ws-1"))?.witnessUrl, null);
});
