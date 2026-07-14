/**
 * Checkout plumbing (M5 #71). Paddle.js opens an overlay checkout; the
 * subscription carries customData.workspaceId, and the webhook (#73) flips
 * the plan server-side. The dashboard never touches money or card data —
 * Paddle is the merchant of record (ADR-0004).
 */

import { request } from "./api.js";
import type { WebSession } from "./session.js";

export interface BillingConfig {
  environment: "sandbox" | "live";
  clientToken: string;
  teamPriceId: string;
}

/** 404s when the server has no Paddle configuration. */
export function getBillingConfig(s: WebSession): Promise<BillingConfig> {
  return request<BillingConfig>("GET", "/v1/billing/config", { token: s.token });
}

export interface SubscriptionInfo {
  status: "trialing" | "active" | "past_due" | "paused" | "canceled";
  currentPeriodEnd: string | null;
  pastDueSince: string | null;
}

/** Subscription state for the billing card (#74). Admin-only. */
export async function getSubscription(s: WebSession): Promise<SubscriptionInfo | null> {
  const res = await request<{ subscription: SubscriptionInfo | null }>(
    "GET",
    `/v1/workspaces/${s.workspaceId}/billing/subscription`,
    { token: s.token },
  );
  return res.subscription;
}

export interface PaddleJs {
  Environment: { set: (env: string) => void };
  Initialize: (opts: { token: string; eventCallback?: (event: { name: string }) => void }) => void;
  Checkout: { open: (opts: unknown) => void };
}

declare global {
  interface Window {
    Paddle?: PaddleJs;
  }
}

const SCRIPT_SRC = "https://cdn.paddle.com/paddle/v2/paddle.js";

let initialized = false;
let currentHandler: ((name: string) => void) | null = null;

/** Load + initialize Paddle.js once; later calls just swap the event handler. */
export async function ensurePaddle(
  config: BillingConfig,
  onEvent: (name: string) => void,
): Promise<PaddleJs> {
  currentHandler = onEvent;
  if (!window.Paddle) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("could not load Paddle"));
      document.head.appendChild(script);
    });
  }
  const paddle = window.Paddle!;
  if (!initialized) {
    if (config.environment === "sandbox") paddle.Environment.set("sandbox");
    paddle.Initialize({
      token: config.clientToken,
      eventCallback: (event) => currentHandler?.(event.name),
    });
    initialized = true;
  }
  return paddle;
}

export function openTeamCheckout(
  paddle: PaddleJs,
  config: BillingConfig,
  args: { workspaceId: string; email?: string | null },
): void {
  paddle.Checkout.open({
    items: [{ priceId: config.teamPriceId, quantity: 1 }],
    customData: { workspaceId: args.workspaceId },
    ...(args.email ? { customer: { email: args.email } } : {}),
    settings: { displayMode: "overlay", theme: "dark" },
  });
}

/** Test seam: module state survives between renders by design. */
export function resetPaddleForTests(): void {
  initialized = false;
  currentHandler = null;
}
