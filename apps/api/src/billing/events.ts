/**
 * Billing webhook event store (M5 #73). One row per Paddle event; the unique
 * paddle_event_id is the idempotency guard for retried deliveries. Payloads
 * are kept whole for reconciliation (#77).
 */

import type { Pool } from "pg";

export interface BillingEventRecord {
  paddleEventId: string;
  eventType: string;
  workspaceId: string | null;
  payload: unknown;
}

export interface BillingEventRepo {
  /** Insert if unseen. Returns false when the event id was already recorded. */
  insertOnce(event: BillingEventRecord): Promise<boolean>;
}

export class InMemoryBillingEventRepo implements BillingEventRepo {
  private readonly seen = new Map<string, BillingEventRecord>();

  async insertOnce(event: BillingEventRecord): Promise<boolean> {
    if (this.seen.has(event.paddleEventId)) return false;
    this.seen.set(event.paddleEventId, event);
    return true;
  }
}

export class PgBillingEventRepo implements BillingEventRepo {
  constructor(private readonly pool: Pool) {}

  async insertOnce(event: BillingEventRecord): Promise<boolean> {
    const res = await this.pool.query(
      `insert into billing_events (paddle_event_id, event_type, workspace_id, payload)
       values ($1, $2, $3, $4)
       on conflict (paddle_event_id) do nothing`,
      [event.paddleEventId, event.eventType, event.workspaceId, JSON.stringify(event.payload)],
    );
    return (res.rowCount ?? 0) > 0;
  }
}
