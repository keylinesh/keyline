/**
 * Audit log data for the dashboard (#42): fetch the workspace's hash-chained
 * events, verify the chain server-side, filter client-side, export CSV/JSON.
 * Admin-only, like the underlying endpoints.
 */

import { request } from "./api.js";
import type { WebSession } from "./session.js";

export interface AuditEvent {
  seq: number;
  action: string;
  outcome: "allowed" | "denied";
  actorMemberId: string | null;
  actorDeviceId: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  hash: string;
  prevHash: string;
}

export type VerifyResult =
  | { ok: true; count: number }
  | { ok: false; brokenSeq: number; reason: string };

const auth = (s: WebSession) => ({ token: s.token });

export async function fetchAudit(s: WebSession): Promise<AuditEvent[]> {
  const { events } = await request<{ events: AuditEvent[] }>(
    "GET",
    `/v1/workspaces/${s.workspaceId}/audit`,
    auth(s),
  );
  return events;
}

export function verifyChain(s: WebSession): Promise<VerifyResult> {
  return request<VerifyResult>("GET", `/v1/workspaces/${s.workspaceId}/audit/verify`, auth(s));
}

export interface AuditFilter {
  environmentId?: string;
  actorMemberId?: string;
  action?: string;
}

export function filterEvents(events: AuditEvent[], filter: AuditFilter): AuditEvent[] {
  return events.filter((e) => {
    if (filter.environmentId && !(e.targetType === "environment" && e.targetId === filter.environmentId)) return false;
    if (filter.actorMemberId && e.actorMemberId !== filter.actorMemberId) return false;
    if (filter.action && e.action !== filter.action) return false;
    return true;
  });
}

/** Distinct actions present, for the filter dropdown. */
export function distinctActions(events: AuditEvent[]): string[] {
  return [...new Set(events.map((e) => e.action))].sort();
}

const csvEscape = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** CSV of events (actor resolved to email where possible). */
export function toCSV(events: AuditEvent[], emailById: Map<string, string>): string {
  const header = "seq,time,actor,action,outcome,target,metadata";
  const lines = events.map((e) =>
    [
      String(e.seq),
      e.createdAt,
      e.actorMemberId ? (emailById.get(e.actorMemberId) ?? e.actorMemberId) : "system",
      e.action,
      e.outcome,
      e.targetType ? `${e.targetType}:${e.targetId}` : "",
      e.metadata && Object.keys(e.metadata).length > 0 ? JSON.stringify(e.metadata) : "",
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

/** Trigger a client-side file download. */
export function download(filename: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
