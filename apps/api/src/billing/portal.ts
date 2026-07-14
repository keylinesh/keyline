/**
 * Paddle customer portal (M5 #72) — self-serve cancel + payment-method
 * changes. We create a short-lived portal session for the workspace's Paddle
 * customer and hand the browser the URLs; everything the customer does there
 * comes back to us as webhooks (#73) and lands in the state machine (#74).
 */

import type { PaddleApi } from "./paddle.js";
import type { SubscriptionRepo } from "./subscriptions.js";

interface PortalSession {
  urls: {
    general: { overview: string };
    subscriptions: Array<{
      id: string;
      cancel_subscription: string;
      update_subscription_payment_method: string;
    }>;
  };
}

export interface PortalLinks {
  overviewUrl: string;
  cancelUrl: string | null;
  updatePaymentMethodUrl: string | null;
}

export type PortalResult =
  | { ok: true; links: PortalLinks }
  | { ok: false; reason: "no_subscription" | "no_customer" };

export class BillingPortalService {
  constructor(
    private readonly paddle: PaddleApi,
    private readonly subscriptions: SubscriptionRepo,
  ) {}

  async createSession(workspaceId: string): Promise<PortalResult> {
    const sub = await this.subscriptions.findByWorkspace(workspaceId);
    if (!sub) return { ok: false, reason: "no_subscription" };
    if (!sub.paddleCustomerId) return { ok: false, reason: "no_customer" };

    const session = await this.paddle.post<PortalSession>(
      `/customers/${sub.paddleCustomerId}/portal-sessions`,
      { subscription_ids: [sub.paddleSubscriptionId] },
    );
    const forSub = session.urls.subscriptions.find((s) => s.id === sub.paddleSubscriptionId);
    return {
      ok: true,
      links: {
        overviewUrl: session.urls.general.overview,
        cancelUrl: forSub?.cancel_subscription ?? null,
        updatePaymentMethodUrl: forSub?.update_subscription_payment_method ?? null,
      },
    };
  }
}
