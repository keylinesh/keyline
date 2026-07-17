/**
 * Subscription state (M5 #74) — the explicit lifecycle behind workspace.plan.
 *
 *   trialing -> active -> past_due -> canceled
 *                     \-> paused
 *
 * Plan consequences live in PLAN_BY_SUBSCRIPTION_STATUS: past_due keeps team
 * (grace, while Paddle's dunning retries payment); paused and canceled drop
 * to team_free (never solo: a lapsed team keeps reading its secrets, only new
 * invites beyond 3 are blocked). Rows are upserted from webhook events,
 * guarded by occurred_at so
 * out-of-order deliveries never regress newer state.
 */

import type { Pool } from "pg";
import type { WorkspacePlan } from "../domain/resources.js";

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "paused" | "canceled";

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  "trialing",
  "active",
  "past_due",
  "paused",
  "canceled",
];

/** The access consequence of each state. Explicit on purpose (#74). */
export const PLAN_BY_SUBSCRIPTION_STATUS: Record<SubscriptionStatus, WorkspacePlan> = {
  trialing: "team",
  active: "team",
  past_due: "team", // grace: Paddle retries payment; downgrade happens on cancel
  paused: "team_free",
  canceled: "team_free",
};

export interface WorkspaceSubscription {
  workspaceId: string;
  paddleSubscriptionId: string;
  paddleCustomerId: string | null;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  pastDueSince: Date | null;
  occurredAt: Date;
}

export interface SubscriptionUpsert {
  workspaceId: string;
  paddleSubscriptionId: string;
  paddleCustomerId: string | null;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  occurredAt: Date;
}

export interface SubscriptionRepo {
  /**
   * Apply an event's state if it is newer than what's stored. Returns the
   * stored row, or null when the event was stale (out-of-order) and ignored.
   */
  upsertIfNewer(input: SubscriptionUpsert): Promise<WorkspaceSubscription | null>;
  findByWorkspace(workspaceId: string): Promise<WorkspaceSubscription | null>;
}

/** past_due_since: set when entering past_due, cleared when leaving it. */
function nextPastDueSince(
  prev: WorkspaceSubscription | null,
  input: SubscriptionUpsert,
): Date | null {
  if (input.status !== "past_due") return null;
  return prev?.status === "past_due" && prev.pastDueSince ? prev.pastDueSince : input.occurredAt;
}

export class InMemorySubscriptionRepo implements SubscriptionRepo {
  private readonly byWorkspace = new Map<string, WorkspaceSubscription>();

  async upsertIfNewer(input: SubscriptionUpsert): Promise<WorkspaceSubscription | null> {
    const prev = this.byWorkspace.get(input.workspaceId) ?? null;
    if (prev && prev.occurredAt.getTime() >= input.occurredAt.getTime()) return null;
    const row: WorkspaceSubscription = {
      workspaceId: input.workspaceId,
      paddleSubscriptionId: input.paddleSubscriptionId,
      paddleCustomerId: input.paddleCustomerId ?? prev?.paddleCustomerId ?? null,
      status: input.status,
      currentPeriodEnd: input.currentPeriodEnd,
      pastDueSince: nextPastDueSince(prev, input),
      occurredAt: input.occurredAt,
    };
    this.byWorkspace.set(input.workspaceId, row);
    return row;
  }

  async findByWorkspace(workspaceId: string): Promise<WorkspaceSubscription | null> {
    return this.byWorkspace.get(workspaceId) ?? null;
  }
}

interface Row {
  workspace_id: string;
  paddle_subscription_id: string;
  paddle_customer_id: string | null;
  status: SubscriptionStatus;
  current_period_end: Date | null;
  past_due_since: Date | null;
  occurred_at: Date;
}

const toSubscription = (r: Row): WorkspaceSubscription => ({
  workspaceId: r.workspace_id,
  paddleSubscriptionId: r.paddle_subscription_id,
  paddleCustomerId: r.paddle_customer_id,
  status: r.status,
  currentPeriodEnd: r.current_period_end,
  pastDueSince: r.past_due_since,
  occurredAt: r.occurred_at,
});

export class PgSubscriptionRepo implements SubscriptionRepo {
  constructor(private readonly pool: Pool) {}

  async upsertIfNewer(input: SubscriptionUpsert): Promise<WorkspaceSubscription | null> {
    // The WHERE guard makes stale (out-of-order) events a no-op atomically.
    const { rows } = await this.pool.query<Row>(
      `insert into workspace_subscriptions
         (workspace_id, paddle_subscription_id, paddle_customer_id, status,
          current_period_end, past_due_since, occurred_at)
       values ($1, $2, $3, $4, $5, case when $4 = 'past_due' then $6::timestamptz end, $6)
       on conflict (workspace_id) do update set
         paddle_subscription_id = excluded.paddle_subscription_id,
         paddle_customer_id = coalesce(excluded.paddle_customer_id, workspace_subscriptions.paddle_customer_id),
         status = excluded.status,
         current_period_end = excluded.current_period_end,
         past_due_since = case
           when excluded.status <> 'past_due' then null
           when workspace_subscriptions.status = 'past_due' then coalesce(workspace_subscriptions.past_due_since, excluded.occurred_at)
           else excluded.occurred_at
         end,
         occurred_at = excluded.occurred_at,
         updated_at = now()
       where workspace_subscriptions.occurred_at < excluded.occurred_at
       returning workspace_id, paddle_subscription_id, paddle_customer_id, status,
                 current_period_end, past_due_since, occurred_at`,
      [
        input.workspaceId,
        input.paddleSubscriptionId,
        input.paddleCustomerId,
        input.status,
        input.currentPeriodEnd,
        input.occurredAt,
      ],
    );
    return rows[0] ? toSubscription(rows[0]) : null;
  }

  async findByWorkspace(workspaceId: string): Promise<WorkspaceSubscription | null> {
    const { rows } = await this.pool.query<Row>(
      `select workspace_id, paddle_subscription_id, paddle_customer_id, status,
              current_period_end, past_due_since, occurred_at
       from workspace_subscriptions where workspace_id = $1`,
      [workspaceId],
    );
    return rows[0] ? toSubscription(rows[0]) : null;
  }
}
