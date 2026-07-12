/**
 * Plan entitlements (#49) — server-side enforcement of Solo/Team limits.
 *
 * Limits live here (not in the schema) so a plan change is a data update, only
 * the billing layer flips `workspace.plan`. Checks return a decision object;
 * routes translate a denial into a 402 `plan_limit` ApiError. Audit retention
 * windows what the list endpoint returns — events are never deleted, and chain
 * verification always walks the full stored chain.
 */

import type { MemberRepo } from "./members.js";
import type {
  EnvironmentRepo,
  ProjectRepo,
  WorkspacePlan,
  WorkspaceRepo,
} from "./resources.js";

export interface PlanLimits {
  /** null = unlimited */
  maxMembers: number | null;
  maxEnvironments: number | null;
  auditRetentionDays: number | null;
}

export const PLAN_LIMITS: Record<WorkspacePlan, PlanLimits> = {
  solo: { maxMembers: 1, maxEnvironments: 2, auditRetentionDays: 7 },
  team: { maxMembers: 10, maxEnvironments: null, auditRetentionDays: null },
};

export type EntitlementDecision =
  | { allowed: true }
  | { allowed: false; message: string; plan: WorkspacePlan; limit: number; current: number };

const deny = (
  message: string,
  plan: WorkspacePlan,
  limit: number,
  current: number,
): EntitlementDecision => ({ allowed: false, message, plan, limit, current });

export class EntitlementsService {
  constructor(
    private readonly workspaces: WorkspaceRepo,
    private readonly projects: ProjectRepo,
    private readonly environments: EnvironmentRepo,
    private readonly members: MemberRepo,
  ) {}

  async planFor(workspaceId: string): Promise<WorkspacePlan> {
    // Unknown workspace falls back to the most restrictive plan.
    return (await this.workspaces.findById(workspaceId))?.plan ?? "solo";
  }

  async limitsFor(workspaceId: string): Promise<{ plan: WorkspacePlan; limits: PlanLimits }> {
    const plan = await this.planFor(workspaceId);
    return { plan, limits: PLAN_LIMITS[plan] };
  }

  async canAddMember(workspaceId: string): Promise<EntitlementDecision> {
    const { plan, limits } = await this.limitsFor(workspaceId);
    if (limits.maxMembers === null) return { allowed: true };
    const current = (await this.members.listByWorkspace(workspaceId)).length;
    if (current < limits.maxMembers) return { allowed: true };
    const upgrade =
      plan === "solo" ? "Upgrade to Team for up to 10 members." : "Contact us for more seats.";
    return deny(
      `The ${plan} plan includes ${limits.maxMembers} member${limits.maxMembers === 1 ? "" : "s"}. ${upgrade}`,
      plan,
      limits.maxMembers,
      current,
    );
  }

  async canCreateEnvironment(workspaceId: string): Promise<EntitlementDecision> {
    const { plan, limits } = await this.limitsFor(workspaceId);
    if (limits.maxEnvironments === null) return { allowed: true };
    let current = 0;
    for (const project of await this.projects.listByWorkspace(workspaceId)) {
      current += (await this.environments.listByProject(project.id)).length;
    }
    if (current < limits.maxEnvironments) return { allowed: true };
    return deny(
      `The ${plan} plan includes ${limits.maxEnvironments} environments. Upgrade to Team for unlimited.`,
      plan,
      limits.maxEnvironments,
      current,
    );
  }

  /** Oldest visible audit timestamp for this workspace, or null for full history. */
  async auditWindowStart(workspaceId: string, now: Date = new Date()): Promise<Date | null> {
    const { limits } = await this.limitsFor(workspaceId);
    if (limits.auditRetentionDays === null) return null;
    return new Date(now.getTime() - limits.auditRetentionDays * 24 * 60 * 60 * 1000);
  }
}
