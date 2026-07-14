import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./app.js";
import { memoryDeps } from "../deps.js";
import { PaddleApi } from "../billing/paddle.js";
import { ReconciliationService } from "../billing/reconcile.js";

test("reconcile endpoint: cron-secret gated (#77)", async () => {
  const deps = memoryDeps();
  const app = createApp(deps);

  // Unconfigured → 503.
  deps.billingReconcile = null;
  deps.cronSecret = null;
  assert.equal((await app.request("/v1/billing/reconcile")).status, 503);

  const emptyPaddle = new PaddleApi(
    { baseUrl: "https://x", apiKey: "k" },
    (async () =>
      new Response(JSON.stringify({ data: [], meta: { pagination: { has_more: false } } }), {
        status: 200,
      })) as unknown as typeof fetch,
  );
  deps.billingReconcile = new ReconciliationService(
    emptyPaddle,
    deps.subscriptions,
    deps.workspaces,
    deps.audit,
  );
  deps.cronSecret = "cr0n-secret";

  assert.equal((await app.request("/v1/billing/reconcile")).status, 401);
  assert.equal(
    (await app.request("/v1/billing/reconcile", { headers: { authorization: "Bearer wrong" } })).status,
    401,
  );

  const ok = await app.request("/v1/billing/reconcile", {
    headers: { authorization: "Bearer cr0n-secret" },
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { checked: 0, healed: 0, orphans: 0, drift: [] });
});

test("anchor endpoint: cron-secret gated (#61)", async () => {
  const deps = memoryDeps();
  const app = createApp(deps);

  deps.cronSecret = null;
  assert.equal((await app.request("/v1/audit/anchor")).status, 503);

  deps.cronSecret = "cr0n-secret";
  assert.equal((await app.request("/v1/audit/anchor")).status, 401);
  const ok = await app.request("/v1/audit/anchor", {
    headers: { authorization: "Bearer cr0n-secret" },
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { workspaces: 0, witnessUrl: null });
});
