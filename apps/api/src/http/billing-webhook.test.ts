import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createApp, type AppDeps } from "./app.js";
import { memoryDeps } from "../deps.js";
import { BillingWebhookService, verifyPaddleSignature } from "../billing/webhook.js";
import { InMemoryBillingEventRepo } from "../billing/events.js";

const SECRET = "pdl_ntfset_test_secret";
const SALT = Buffer.from("0123456789abcdef").toString("base64");
const readJson = (r: Response): Promise<any> => r.json();

/** Sign a body exactly the way Paddle does. */
function sign(rawBody: string, secret = SECRET, ts = Math.floor(Date.now() / 1000)): string {
  const h1 = createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");
  return `ts=${ts};h1=${h1}`;
}

async function setup() {
  const deps: AppDeps = memoryDeps();
  deps.billingWebhook = new BillingWebhookService(
    SECRET,
    new InMemoryBillingEventRepo(),
    deps.workspaces,
    deps.audit,
    deps.subscriptions,
  );
  const app = createApp(deps);
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });

  const post = (rawBody: string, signature?: string) =>
    app.request("/v1/billing/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signature === undefined ? {} : { "paddle-signature": signature }),
      },
      body: rawBody,
    });

  const subscriptionEvent = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      event_id: `evt_${Math.random().toString(36).slice(2)}`,
      event_type: "subscription.activated",
      data: {
        id: "sub_123",
        status: "active",
        custom_data: { workspaceId: ws.id },
        ...overrides,
      },
    });

  return { deps, app, ws, post, subscriptionEvent };
}

test("subscription.activated flips the workspace to team and audits it", async () => {
  const { deps, ws, post, subscriptionEvent } = await setup();
  const body = subscriptionEvent();

  const res = await post(body, sign(body));
  assert.equal(res.status, 200);
  assert.equal((await readJson(res)).result, "applied");
  assert.equal((await deps.workspaces.findById(ws.id))?.plan, "team");

  const events = await deps.audit.list(ws.id);
  const change = events.find((e) => e.action === "billing.plan_change");
  assert.ok(change, "plan change audited");
  assert.equal(change!.metadata.plan, "team");
  assert.equal(change!.metadata.previousPlan, "solo");
});

test("subscription.canceled drops the workspace back to solo", async () => {
  const { deps, ws, post, subscriptionEvent } = await setup();
  await deps.workspaces.update(ws.id, { plan: "team" });

  const body = JSON.stringify({
    event_id: "evt_cancel",
    event_type: "subscription.canceled",
    data: { id: "sub_123", status: "canceled", custom_data: { workspaceId: ws.id } },
  });
  const res = await post(body, sign(body));
  assert.equal((await readJson(res)).result, "applied");
  assert.equal((await deps.workspaces.findById(ws.id))?.plan, "solo");
});

test("a retried delivery is acked but not re-applied", async () => {
  const { deps, ws, post } = await setup();
  const body = JSON.stringify({
    event_id: "evt_once",
    event_type: "subscription.activated",
    data: { id: "sub_123", status: "active", custom_data: { workspaceId: ws.id } },
  });

  assert.equal((await readJson(await post(body, sign(body)))).result, "applied");
  // Simulate out-of-band downgrade, then replay the same event: must not re-flip.
  await deps.workspaces.update(ws.id, { plan: "solo" });
  assert.equal((await readJson(await post(body, sign(body)))).result, "duplicate");
  assert.equal((await deps.workspaces.findById(ws.id))?.plan, "solo");
});

test("bad or missing signatures are 401 and change nothing", async () => {
  const { deps, ws, post, subscriptionEvent } = await setup();
  const body = subscriptionEvent();

  assert.equal((await post(body)).status, 401);
  assert.equal((await post(body, sign(body, "wrong_secret"))).status, 401);
  assert.equal((await post(body, sign(body.replace("active", "activeX")))).status, 401);
  // Stale timestamp (10 minutes old) is rejected too.
  assert.equal((await post(body, sign(body, SECRET, Math.floor(Date.now() / 1000) - 600))).status, 401);
  assert.equal((await deps.workspaces.findById(ws.id))?.plan, "solo");
});

test("unknown workspace and non-subscription events are recorded, not applied", async () => {
  const { deps, ws, post } = await setup();

  const foreign = JSON.stringify({
    event_id: "evt_fw",
    event_type: "subscription.activated",
    data: { id: "sub_9", status: "active", custom_data: { workspaceId: "00000000-0000-0000-0000-000000000000" } },
  });
  assert.equal((await readJson(await post(foreign, sign(foreign)))).result, "ignored");

  const txn = JSON.stringify({
    event_id: "evt_txn",
    event_type: "transaction.completed",
    data: { id: "txn_1", custom_data: { workspaceId: ws.id } },
  });
  assert.equal((await readJson(await post(txn, sign(txn)))).result, "recorded");

  assert.equal((await deps.workspaces.findById(ws.id))?.plan, "solo");
});

// ---- Lifecycle / state machine (#74) ----

function lifecycleEvent(
  wsId: string,
  status: string,
  occurredAt: string,
  overrides: Record<string, unknown> = {},
) {
  return JSON.stringify({
    event_id: `evt_${status}_${occurredAt}`,
    event_type: `subscription.${status === "active" ? "activated" : status}`,
    occurred_at: occurredAt,
    data: {
      id: "sub_lc",
      status,
      customer_id: "ctm_1",
      current_billing_period: { ends_at: "2026-08-01T00:00:00Z" },
      custom_data: { workspaceId: wsId },
      ...overrides,
    },
  });
}

test("past_due keeps team (grace) and records when it started; cancel then downgrades", async () => {
  const { deps, ws, post } = await setup();
  const t = (m: number) => `2026-07-14T12:${String(m).padStart(2, "0")}:00Z`;

  await post(lifecycleEvent(ws.id, "trialing", t(1)), sign(lifecycleEvent(ws.id, "trialing", t(1))));
  assert.equal((await deps.workspaces.findById(ws.id))?.plan, "team");

  const pd = lifecycleEvent(ws.id, "past_due", t(10));
  assert.equal((await readJson(await post(pd, sign(pd)))).result, "applied");
  assert.equal((await deps.workspaces.findById(ws.id))?.plan, "team", "grace: still team");
  let sub = await deps.subscriptions.findByWorkspace(ws.id);
  assert.equal(sub?.status, "past_due");
  assert.equal(sub?.pastDueSince?.toISOString(), new Date(t(10)).toISOString());

  const cancel = lifecycleEvent(ws.id, "canceled", t(30));
  assert.equal((await readJson(await post(cancel, sign(cancel)))).result, "applied");
  assert.equal((await deps.workspaces.findById(ws.id))?.plan, "solo");
  sub = await deps.subscriptions.findByWorkspace(ws.id);
  assert.equal(sub?.status, "canceled");
  assert.equal(sub?.pastDueSince, null);
});

test("paused drops to solo; resuming restores team", async () => {
  const { deps, ws, post } = await setup();
  const t = (m: number) => `2026-07-14T13:${String(m).padStart(2, "0")}:00Z`;

  await post(lifecycleEvent(ws.id, "active", t(1)), sign(lifecycleEvent(ws.id, "active", t(1))));
  const paused = lifecycleEvent(ws.id, "paused", t(5));
  await post(paused, sign(paused));
  assert.equal((await deps.workspaces.findById(ws.id))?.plan, "solo");

  const resumed = lifecycleEvent(ws.id, "active", t(9));
  await post(resumed, sign(resumed));
  assert.equal((await deps.workspaces.findById(ws.id))?.plan, "team");
});

test("an out-of-order older event never regresses newer state", async () => {
  const { deps, ws, post } = await setup();
  const cancel = lifecycleEvent(ws.id, "canceled", "2026-07-14T15:00:00Z");
  await post(cancel, sign(cancel));
  assert.equal((await deps.workspaces.findById(ws.id))?.plan, "solo");

  // A delayed 'activated' from BEFORE the cancel arrives late: must be ignored.
  const stale = lifecycleEvent(ws.id, "active", "2026-07-14T14:00:00Z");
  const res = await readJson(await post(stale, sign(stale)));
  assert.equal(res.result, "ignored");
  assert.equal((await deps.workspaces.findById(ws.id))?.plan, "solo");
  assert.equal((await deps.subscriptions.findByWorkspace(ws.id))?.status, "canceled");
});

test("subscription endpoint: admin sees status, member is 403, empty is null", async () => {
  const { deps, ws, post, app } = await setup();
  const adminTok = (await deps.tokens.issue({
    deviceId: "d-a", memberId: "m-a", scope: { workspaceId: ws.id, role: "admin" },
  })).token;
  const memberTok = (await deps.tokens.issue({
    deviceId: "d-m", memberId: "m-m", scope: { workspaceId: ws.id, role: "member" },
  })).token;
  const get = (t: string) =>
    app.request(`/v1/workspaces/${ws.id}/billing/subscription`, {
      headers: { authorization: `Bearer ${t}` },
    });

  assert.deepEqual(await readJson(await get(adminTok)), { subscription: null });
  assert.equal((await get(memberTok)).status, 403);

  const pd = lifecycleEvent(ws.id, "past_due", "2026-07-14T16:00:00Z");
  await post(pd, sign(pd));
  const body = await readJson(await get(adminTok));
  assert.equal(body.subscription.status, "past_due");
  assert.equal(body.subscription.pastDueSince, "2026-07-14T16:00:00.000Z");
  assert.equal(body.subscription.currentPeriodEnd, "2026-08-01T00:00:00.000Z");
});

test("the endpoint is 503 until a webhook secret is configured", async () => {
  const deps = memoryDeps();
  deps.billingWebhook = null;
  const app = createApp(deps);
  const res = await app.request("/v1/billing/webhook", { method: "POST", body: "{}" });
  assert.equal(res.status, 503);
});

test("billing config: auth required, 404 unconfigured, public values when set (#71)", async () => {
  const deps = memoryDeps();
  deps.billingConfig = null;
  const app = createApp(deps);
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  const tok = (await deps.tokens.issue({
    deviceId: "dev-a", memberId: "mem-a", scope: { workspaceId: ws.id, role: "member" },
  })).token;

  assert.equal((await app.request("/v1/billing/config")).status, 401);
  assert.equal(
    (await app.request("/v1/billing/config", { headers: { authorization: `Bearer ${tok}` } })).status,
    404,
  );

  deps.billingConfig = { environment: "sandbox", clientToken: "test_t", teamPriceId: "pri_1" };
  const res = await app.request("/v1/billing/config", { headers: { authorization: `Bearer ${tok}` } });
  assert.equal(res.status, 200);
  assert.deepEqual(await readJson(res), {
    environment: "sandbox",
    clientToken: "test_t",
    teamPriceId: "pri_1",
  });
});

test("verifyPaddleSignature handles rotation (two h1 values) and malformed headers", () => {
  const body = '{"a":1}';
  const ts = Math.floor(Date.now() / 1000);
  const good = createHmac("sha256", SECRET).update(`${ts}:${body}`).digest("hex");

  assert.equal(verifyPaddleSignature(body, `ts=${ts};h1=${"0".repeat(64)};h1=${good}`, SECRET), true);
  assert.equal(verifyPaddleSignature(body, undefined, SECRET), false);
  assert.equal(verifyPaddleSignature(body, "not-a-header", SECRET), false);
  assert.equal(verifyPaddleSignature(body, `ts=${ts}`, SECRET), false);
  assert.equal(verifyPaddleSignature(body, `h1=${good}`, SECRET), false);
});
