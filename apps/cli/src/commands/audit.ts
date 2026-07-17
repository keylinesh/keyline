/**
 * `keyline audit` — who did what, from the terminal (#35).
 *
 * Reads the workspace's hash-chained audit log (M2 #24), maps actor member ids
 * to emails, and optionally filters to one environment of the linked project
 * (--env). --verify asks the server to re-walk the whole chain. Admin-only,
 * like the underlying endpoints.
 */

import {
  resolveSession,
  resolveSyncContext,
  type SyncDeps,
  type SyncInput,
} from "./sync-context.js";

interface RawEvent {
  seq: number;
  action: string;
  outcome: string;
  actorMemberId: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditEventRow {
  seq: number;
  createdAt: string;
  outcome: string;
  action: string;
  /** Actor email when resolvable, else the raw member id, else "system". */
  actor: string;
  target: string | null;
  metadata: Record<string, unknown> | null;
}

export interface AuditInput extends SyncInput {
  /** Only events touching this environment (resolved in the linked project). */
  env?: string;
  /** Keep only the most recent N events. */
  limit?: number;
}

export interface AuditResult {
  events: AuditEventRow[];
  total: number;
  env?: string;
  /** Present when the plan windows history. */
  retentionDays?: number | null;
}

export async function runAudit(deps: SyncDeps, input: AuditInput = {}): Promise<AuditResult> {
  const session = resolveSession(deps);

  let envFilter: { id: string; name: string } | undefined;
  if (input.env) {
    const ctx = resolveSyncContext(deps, input);
    const { environments } = await ctx.api.get<{
      environments: Array<{ id: string; name: string }>;
    }>(`/v1/projects/${ctx.binding.projectId}/environments`);
    envFilter = environments.find((e) => e.name === input.env);
    if (!envFilter) {
      const names = environments.map((e) => e.name).join(", ") || "none";
      throw new Error(`No environment "${input.env}" in this project (have: ${names}).`);
    }
  }

  const [{ events, retentionDays }, { members }] = await Promise.all([
    session.api.get<{ events: RawEvent[]; retentionDays?: number | null }>(
      `/v1/workspaces/${session.account.workspaceId}/audit`,
    ),
    session.api.get<{ members: Array<{ id: string; email: string }> }>(
      `/v1/workspaces/${session.account.workspaceId}/members`,
    ),
  ]);
  const emailById = new Map(members.map((m) => [m.id, m.email]));

  let filtered = envFilter
    ? events.filter((e) => e.targetType === "environment" && e.targetId === envFilter.id)
    : events;
  const total = filtered.length;
  if (input.limit && input.limit > 0) filtered = filtered.slice(-input.limit);

  return {
    events: filtered.map((e) => ({
      seq: e.seq,
      createdAt: e.createdAt,
      outcome: e.outcome,
      action: e.action,
      actor: e.actorMemberId ? (emailById.get(e.actorMemberId) ?? e.actorMemberId) : "system",
      target: e.targetType ? `${e.targetType}:${e.targetId}` : null,
      metadata: e.metadata,
    })),
    total,
    retentionDays,
    env: envFilter?.name,
  };
}

export interface VerifyResult {
  ok: boolean;
  count?: number;
  brokenSeq?: number;
  reason?: string;
}

export async function runAuditVerify(deps: SyncDeps): Promise<VerifyResult> {
  const session = resolveSession(deps);
  return session.api.get<VerifyResult>(
    `/v1/workspaces/${session.account.workspaceId}/audit/verify`,
  );
}
