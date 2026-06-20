/**
 * @keyline/shared — types and constants shared across the CLI, API, and dashboard.
 * These mirror the data model; the authoritative schema lives in the API (milestone M2).
 */

export type Role = "admin" | "write" | "read";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

export type Plan = "solo" | "team";

/** Plan entitlements enforced server-side (see milestone M5). */
export interface PlanLimits {
  maxMembers: number;
  maxEnvironments: number;
  /** Audit history retention in days; null = unlimited. */
  auditRetentionDays: number | null;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  solo: { maxMembers: 1, maxEnvironments: 2, auditRetentionDays: 7 },
  team: { maxMembers: 10, maxEnvironments: Infinity, auditRetentionDays: null },
};

export interface Member {
  id: string;
  email: string;
  role: Role;
}

export interface Environment {
  id: string;
  name: string;
  projectId: string;
}

export interface AuditEvent {
  id: string;
  at: string; // ISO timestamp
  actor: string;
  action: string;
  environmentId: string | null;
  /** Hash chain link for tamper-evidence (milestone M2). */
  prevHash: string | null;
  hash: string;
}
