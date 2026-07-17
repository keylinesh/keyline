import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryDeps } from "../deps.js";
import { PaddleApi } from "./paddle.js";
import { ReconciliationService } from "./reconcile.js";

const SALT = Buffer.from("0123456789abcdef").toString("base64");

function paddleWith(subs: unknown[]) {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({ data: subs, meta: { pagination: { has_more: false } } }),
      { status: 200 },
    )) as unknown as typeof fetch;
  return new PaddleApi({ baseUrl: "https://sandbox-api.paddle.com", apiKey: "k" }, fetchImpl);
}

const paddleSub = (workspaceId: string, status: string, id = "sub_r") => ({
  id,
  status,
  customer_id: "ctm_r",
  current_billing_period: { ends_at: "2026-08-01T00:00:00Z" },
  custom_data: { workspaceId },
});

test("reconcile heals a workspace whose webhooks were lost (the prod incident)", async () => {
  const deps = memoryDeps();
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  // Paddle says active; we have no subscription row and the plan is still solo.
  const service = new ReconciliationService(
    paddleWith([paddleSub(ws.id, "active")]),
    deps.subscriptions,
    deps.workspaces,
    deps.audit,
  );

  const report = await service.run();
  assert.equal(report.checked, 1);
  assert.equal(report.healed, 1);
  assert.equal(report.entries[0]!.action, "healed_both");
  assert.equal((await deps.workspaces.findById(ws.id))?.plan, "team");
  assert.equal((await deps.subscriptions.findByWorkspace(ws.id))?.status, "active");

  const audited = (await deps.audit.list(ws.id)).find((e) => e.action === "billing.reconcile");
  assert.ok(audited, "healing is audited");
  assert.equal(audited!.metadata.previousPlan, "solo");
});

test("reconcile is a no-op when everything is in sync, and downgrades on canceled drift", async () => {
  const deps = memoryDeps();
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  await deps.workspaces.update(ws.id, { plan: "team" });
  await deps.subscriptions.upsertIfNewer({
    workspaceId: ws.id, paddleSubscriptionId: "sub_r", paddleCustomerId: "ctm_r",
    status: "active", currentPeriodEnd: null, occurredAt: new Date("2026-07-14T10:00:00Z"),
  });

  const inSync = await new ReconciliationService(
    paddleWith([paddleSub(ws.id, "active")]),
    deps.subscriptions, deps.workspaces, deps.audit,
  ).run();
  assert.equal(inSync.healed, 0);
  assert.equal(inSync.entries[0]!.action, "in_sync");

  // Paddle canceled it but we never heard: downgrade + heal the row.
  const drifted = await new ReconciliationService(
    paddleWith([paddleSub(ws.id, "canceled")]),
    deps.subscriptions, deps.workspaces, deps.audit,
  ).run();
  assert.equal(drifted.healed, 1);
  assert.equal((await deps.workspaces.findById(ws.id))?.plan, "team_free");
  assert.equal((await deps.subscriptions.findByWorkspace(ws.id))?.status, "canceled");
});

test("subscriptions for unknown workspaces are reported as orphans, not applied", async () => {
  const deps = memoryDeps();
  const report = await new ReconciliationService(
    paddleWith([paddleSub("00000000-0000-0000-0000-000000000000", "active")]),
    deps.subscriptions, deps.workspaces, deps.audit,
  ).run();
  assert.equal(report.orphans, 1);
  assert.equal(report.entries[0]!.action, "orphan");
});

test("subscriptions without a workspaceId are skipped", async () => {
  const deps = memoryDeps();
  const report = await new ReconciliationService(
    paddleWith([{ id: "sub_x", status: "active", custom_data: null }]),
    deps.subscriptions, deps.workspaces, deps.audit,
  ).run();
  assert.equal(report.checked, 0);
});
