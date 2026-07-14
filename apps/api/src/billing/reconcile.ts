/**
 * Billing reconciliation (M5 #77) — detect and heal drift between Paddle
 * (the source of truth for money) and our DB (workspace_subscriptions +
 * workspace.plan). Drift is real: webhooks can fail, deploys can lag behind
 * checkouts (it happened, see MR !61). Runs daily via Vercel cron and on
 * demand via `pnpm --filter @keyline/api paddle:reconcile`.
 */

import type { AuditService } from "../domain/audit.js";
import type { WorkspaceRepo } from "../domain/resources.js";
import type { PaddleApi } from "./paddle.js";
import {
  PLAN_BY_SUBSCRIPTION_STATUS,
  SUBSCRIPTION_STATUSES,
  type SubscriptionRepo,
  type SubscriptionStatus,
} from "./subscriptions.js";

interface PaddleSubscription {
  id: string;
  status: string;
  customer_id: string | null;
  updated_at?: string;
  current_billing_period?: { ends_at?: string | null } | null;
  custom_data?: Record<string, unknown> | null;
}

export interface ReconcileEntry {
  workspaceId: string;
  subscriptionId: string;
  paddleStatus: string;
  storedStatus: string | null;
  workspacePlan: string | null;
  action: "in_sync" | "healed_subscription" | "healed_plan" | "healed_both" | "orphan";
}

export interface ReconcileReport {
  checked: number;
  healed: number;
  orphans: number;
  entries: ReconcileEntry[];
}

export class ReconciliationService {
  constructor(
    private readonly paddle: PaddleApi,
    private readonly subscriptions: SubscriptionRepo,
    private readonly workspaces: WorkspaceRepo,
    private readonly audit: AuditService,
  ) {}

  async run(now: Date = new Date()): Promise<ReconcileReport> {
    const subs = await this.paddle.getAll<PaddleSubscription>("/subscriptions?per_page=200");
    const entries: ReconcileEntry[] = [];

    for (const sub of subs) {
      const workspaceId = sub.custom_data?.workspaceId;
      if (typeof workspaceId !== "string" || !workspaceId) continue;
      const status = sub.status as SubscriptionStatus;
      if (!SUBSCRIPTION_STATUSES.includes(status)) continue;

      const workspace = await this.workspaces.findById(workspaceId);
      const stored = await this.subscriptions.findByWorkspace(workspaceId);
      const entry: ReconcileEntry = {
        workspaceId,
        subscriptionId: sub.id,
        paddleStatus: status,
        storedStatus: stored?.status ?? null,
        workspacePlan: workspace?.plan ?? null,
        action: "in_sync",
      };
      entries.push(entry);

      if (!workspace) {
        entry.action = "orphan"; // Paddle knows a workspace we don't — investigate
        continue;
      }

      const statusDrift = stored?.status !== status;
      if (statusDrift) {
        // Paddle's current state wins; stamp it with `now` so the upsert
        // outranks whatever stale occurred_at we hold.
        await this.subscriptions.upsertIfNewer({
          workspaceId,
          paddleSubscriptionId: sub.id,
          paddleCustomerId: sub.customer_id ?? null,
          status,
          currentPeriodEnd: sub.current_billing_period?.ends_at
            ? new Date(sub.current_billing_period.ends_at)
            : null,
          occurredAt: now,
        });
      }

      const expectedPlan = PLAN_BY_SUBSCRIPTION_STATUS[status];
      const previousPlan = workspace.plan;
      const planDrift = previousPlan !== expectedPlan;
      if (planDrift) {
        await this.workspaces.update(workspaceId, { plan: expectedPlan });
        await this.audit.record({
          workspaceId,
          action: "billing.reconcile",
          targetType: "workspace",
          targetId: workspaceId,
          outcome: "allowed",
          metadata: {
            plan: expectedPlan,
            previousPlan,
            subscriptionStatus: status,
            subscriptionId: sub.id,
          },
        });
      }

      entry.action =
        statusDrift && planDrift
          ? "healed_both"
          : statusDrift
            ? "healed_subscription"
            : planDrift
              ? "healed_plan"
              : "in_sync";
    }

    return {
      checked: entries.length,
      healed: entries.filter((e) => e.action.startsWith("healed")).length,
      orphans: entries.filter((e) => e.action === "orphan").length,
      entries,
    };
  }
}
