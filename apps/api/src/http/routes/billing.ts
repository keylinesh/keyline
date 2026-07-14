/**
 * Billing routes (M5 #71/#73).
 *
 * The webhook is public: Paddle authenticates by signing the body, not with a
 * bearer token; 503 until PADDLE_WEBHOOK_SECRET is set. The config endpoint
 * gives a signed-in dashboard what it needs to open a Paddle checkout.
 */

import type { Hono, MiddlewareHandler } from "hono";
import type { BillingPublicConfig } from "../../billing/paddle.js";
import type { BillingPortalService } from "../../billing/portal.js";
import type { SubscriptionRepo } from "../../billing/subscriptions.js";
import type { BillingWebhookService } from "../../billing/webhook.js";
import { type AppEnv, requireRole, requireWorkspace } from "../authz.js";
import { ApiError, notFound } from "../errors.js";

export interface BillingRouteDeps {
  /** null when billing webhooks aren't configured (no PADDLE_WEBHOOK_SECRET). */
  billingWebhook: BillingWebhookService | null;
  /** null when checkout isn't configured (no client token / price id). */
  billingConfig: BillingPublicConfig | null;
  subscriptions: SubscriptionRepo;
  /** null when the server has no Paddle API key. */
  billingPortal: BillingPortalService | null;
}

export function registerBillingRoutes(
  app: Hono<AppEnv>,
  deps: BillingRouteDeps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  app.post("/v1/billing/webhook", async (c) => {
    if (!deps.billingWebhook) {
      throw new ApiError(503, "internal", "billing webhooks not configured");
    }
    const raw = await c.req.text();
    const outcome = await deps.billingWebhook.handle(raw, c.req.header("paddle-signature"));
    if (!outcome.ok) throw new ApiError(outcome.status, "unauthorized", outcome.error);
    return c.json({ ok: true, result: outcome.result });
  });

  app.get("/v1/billing/config", auth, async (c) => {
    if (!deps.billingConfig) throw notFound("billing not configured");
    return c.json(deps.billingConfig);
  });

  // Customer portal (#72): short-lived Paddle session for cancel/card changes.
  app.post("/v1/workspaces/:wid/billing/portal", auth, async (c) => {
    const wid = c.req.param("wid");
    requireWorkspace(c.get("principal"), wid);
    requireRole(c.get("principal"), "admin");
    if (!deps.billingPortal) throw new ApiError(503, "internal", "billing not configured");
    const result = await deps.billingPortal.createSession(wid);
    if (!result.ok) throw notFound("no subscription for this workspace");
    return c.json(result.links);
  });

  // Subscription state for the billing UI (#74). Admin-only, like audit.
  app.get("/v1/workspaces/:wid/billing/subscription", auth, async (c) => {
    const wid = c.req.param("wid");
    requireWorkspace(c.get("principal"), wid);
    requireRole(c.get("principal"), "admin");
    const sub = await deps.subscriptions.findByWorkspace(wid);
    if (!sub) return c.json({ subscription: null });
    return c.json({
      subscription: {
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
        pastDueSince: sub.pastDueSince?.toISOString() ?? null,
      },
    });
  });
}
