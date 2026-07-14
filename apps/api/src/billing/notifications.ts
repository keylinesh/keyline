/**
 * Paddle notification destination (M5 #73). ensureWebhookDestination() is
 * idempotent like the catalog: finds an active url-destination for the given
 * URL, creates it if missing, and returns the endpoint secret used to verify
 * Paddle-Signature headers (PADDLE_WEBHOOK_SECRET).
 */

import type { PaddleApi } from "./paddle.js";

/** Everything the plan lifecycle (#73/#74) and reconciliation (#77) care about. */
export const SUBSCRIBED_EVENTS = [
  "subscription.created",
  "subscription.trialing",
  "subscription.activated",
  "subscription.updated",
  "subscription.paused",
  "subscription.resumed",
  "subscription.past_due",
  "subscription.canceled",
  "transaction.completed",
  "transaction.payment_failed",
] as const;

interface NotificationSetting {
  id: string;
  destination: string;
  type: string;
  active: boolean;
  endpoint_secret_key: string;
}

export interface WebhookDestinationResult {
  id: string;
  secret: string;
  created: boolean;
}

export async function ensureWebhookDestination(
  api: PaddleApi,
  url: string,
): Promise<WebhookDestinationResult> {
  const settings = await api.get<NotificationSetting[]>("/notification-settings?per_page=200");
  const existing = settings.find((s) => s.type === "url" && s.destination === url && s.active);
  if (existing) return { id: existing.id, secret: existing.endpoint_secret_key, created: false };

  const created = await api.post<NotificationSetting>("/notification-settings", {
    description: "Keyline billing webhooks",
    destination: url,
    type: "url",
    subscribed_events: [...SUBSCRIBED_EVENTS],
  });
  return { id: created.id, secret: created.endpoint_secret_key, created: true };
}
