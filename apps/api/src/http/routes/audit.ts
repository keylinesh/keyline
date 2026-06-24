/**
 * Audit log routes (#24) — workspace admins can read the log and verify its
 * integrity. Events are recorded by the actions themselves (see bundles.ts,
 * members.ts); these endpoints are read + verify only.
 */

import type { Hono, MiddlewareHandler } from "hono";
import type { AuditEvent, AuditService } from "../../domain/audit.js";
import { type AppEnv, requireRole, requireWorkspace } from "../authz.js";

export interface AuditRouteDeps {
  audit: AuditService;
}

const view = (e: AuditEvent) => ({
  seq: e.seq,
  action: e.action,
  outcome: e.outcome,
  actorMemberId: e.actorMemberId,
  actorDeviceId: e.actorDeviceId,
  targetType: e.targetType,
  targetId: e.targetId,
  metadata: e.metadata,
  createdAt: e.createdAt.toISOString(),
  hash: e.hash,
  prevHash: e.prevHash,
});

export function registerAuditRoutes(
  app: Hono<AppEnv>,
  deps: AuditRouteDeps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  app.get("/v1/workspaces/:wid/audit", auth, async (c) => {
    const wid = c.req.param("wid");
    requireWorkspace(c.get("principal"), wid);
    requireRole(c.get("principal"), "admin");
    const events = await deps.audit.list(wid);
    return c.json({ events: events.map(view) });
  });

  app.get("/v1/workspaces/:wid/audit/verify", auth, async (c) => {
    const wid = c.req.param("wid");
    requireWorkspace(c.get("principal"), wid);
    requireRole(c.get("principal"), "admin");
    return c.json(await deps.audit.verify(wid));
  });
}
