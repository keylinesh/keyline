/**
 * Paddle webhook processing (M5 #73) — the backbone of payment correctness.
 *
 * Every delivery is verified against the Paddle-Signature header
 * (HMAC-SHA256 over `${ts}:${rawBody}` with the destination's secret key),
 * recorded once (billing_events unique id = idempotency), and then applied:
 * subscription events flip `workspace.plan` using the workspaceId that
 * checkout (#71) puts in the subscription's custom_data. Everything else is
 * recorded and acked for reconciliation (#77).
 *
 * The raw body BYTES matter: the HMAC is computed over exactly what Paddle
 * sent. The route hands us Hono's `c.req.text()`; on Vercel the function
 * entry disables body parsing for this to be the true wire bytes (see
 * api/[[...route]].ts).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuditService } from "../domain/audit.js";
import type { WorkspaceRepo } from "../domain/resources.js";
import type { BillingEventRepo } from "./events.js";
import {
  PLAN_BY_SUBSCRIPTION_STATUS,
  SUBSCRIPTION_STATUSES,
  type SubscriptionRepo,
  type SubscriptionStatus,
} from "./subscriptions.js";

/** Reject signatures older than this — Paddle re-signs retries at send time. */
const MAX_AGE_SECONDS = 5 * 60;

/** Paddle-Signature: `ts=1671552777;h1=abc...` (h1 may repeat during secret rotation). */
export function verifyPaddleSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  now: Date = new Date(),
): boolean {
  if (!header) return false;
  const parts = new Map<string, string[]>();
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 1) return false;
    const key = pair.slice(0, eq).trim();
    (parts.get(key) ?? parts.set(key, []).get(key)!).push(pair.slice(eq + 1).trim());
  }
  const ts = Number(parts.get("ts")?.[0]);
  const hashes = parts.get("h1") ?? [];
  if (!Number.isInteger(ts) || hashes.length === 0) return false;
  if (Math.abs(now.getTime() / 1000 - ts) > MAX_AGE_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");
  return hashes.some((h) => {
    const a = Buffer.from(h, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

interface PaddleEvent {
  event_id: string;
  event_type: string;
  occurred_at?: string;
  data: {
    id?: string;
    status?: string;
    customer_id?: string | null;
    current_billing_period?: { ends_at?: string | null } | null;
    custom_data?: Record<string, unknown> | null;
  };
}

export type WebhookOutcome =
  | { ok: true; result: "applied" | "duplicate" | "recorded" | "ignored"; detail?: string }
  | { ok: false; status: 401 | 422; error: string };

export class BillingWebhookService {
  constructor(
    private readonly secret: string,
    private readonly events: BillingEventRepo,
    private readonly workspaces: WorkspaceRepo,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionRepo,
  ) {}

  async handle(rawBody: string, signature: string | undefined, now?: Date): Promise<WebhookOutcome> {
    if (!verifyPaddleSignature(rawBody, signature, this.secret, now)) {
      return { ok: false, status: 401, error: "invalid signature" };
    }

    let event: PaddleEvent;
    try {
      event = JSON.parse(rawBody) as PaddleEvent;
    } catch {
      return { ok: false, status: 422, error: "not json" };
    }
    if (!event.event_id || !event.event_type) {
      return { ok: false, status: 422, error: "not a paddle event" };
    }

    const workspaceId = this.workspaceIdOf(event);
    const fresh = await this.events.insertOnce({
      paddleEventId: event.event_id,
      eventType: event.event_type,
      workspaceId,
      payload: event,
    });
    if (!fresh) return { ok: true, result: "duplicate" };

    if (!event.event_type.startsWith("subscription.")) {
      return { ok: true, result: "recorded" };
    }
    if (!workspaceId) return { ok: true, result: "ignored", detail: "no workspaceId" };

    const status = event.data.status as SubscriptionStatus | undefined;
    if (!status || !SUBSCRIPTION_STATUSES.includes(status)) {
      return { ok: true, result: "ignored", detail: `status ${event.data.status}` };
    }
    const workspace = await this.workspaces.findById(workspaceId);
    if (!workspace) return { ok: true, result: "ignored", detail: "unknown workspace" };

    // The state machine row first; a stale (out-of-order) event stops here.
    const occurredAt = event.occurred_at ? new Date(event.occurred_at) : new Date();
    const periodEnd = event.data.current_billing_period?.ends_at;
    const stored = await this.subscriptions.upsertIfNewer({
      workspaceId,
      paddleSubscriptionId: event.data.id ?? "unknown",
      paddleCustomerId: event.data.customer_id ?? null,
      status,
      currentPeriodEnd: periodEnd ? new Date(periodEnd) : null,
      occurredAt,
    });
    if (!stored) return { ok: true, result: "ignored", detail: "stale event" };

    // Then the access consequence.
    const plan = PLAN_BY_SUBSCRIPTION_STATUS[status];
    const previousPlan = workspace.plan;
    if (previousPlan === plan) return { ok: true, result: "applied", detail: `status ${status}` };

    await this.workspaces.update(workspaceId, { plan });
    await this.audit.record({
      workspaceId,
      action: "billing.plan_change",
      targetType: "workspace",
      targetId: workspaceId,
      outcome: "allowed",
      metadata: {
        plan,
        previousPlan,
        subscriptionStatus: status,
        subscriptionId: event.data.id ?? null,
        eventType: event.event_type,
      },
    });
    return { ok: true, result: "applied", detail: plan };
  }

  private workspaceIdOf(event: PaddleEvent): string | null {
    const raw = event.data.custom_data?.workspaceId;
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  }
}
