/**
 * Billing webhook route (M5 #73). Public: Paddle authenticates by signing the
 * body, not with a bearer token. 503 until PADDLE_WEBHOOK_SECRET is set.
 */

import type { Hono } from "hono";
import type { BillingWebhookService } from "../../billing/webhook.js";
import type { AppEnv } from "../authz.js";
import { ApiError } from "../errors.js";

export interface BillingRouteDeps {
  /** null when billing webhooks aren't configured (no PADDLE_WEBHOOK_SECRET). */
  billingWebhook: BillingWebhookService | null;
}

export function registerBillingRoutes(app: Hono<AppEnv>, deps: BillingRouteDeps): void {
  app.post("/v1/billing/webhook", async (c) => {
    if (!deps.billingWebhook) {
      throw new ApiError(503, "internal", "billing webhooks not configured");
    }
    const raw = await c.req.text();
    const outcome = await deps.billingWebhook.handle(raw, c.req.header("paddle-signature"));
    if (!outcome.ok) throw new ApiError(outcome.status, "unauthorized", outcome.error);
    return c.json({ ok: true, result: outcome.result });
  });
}
