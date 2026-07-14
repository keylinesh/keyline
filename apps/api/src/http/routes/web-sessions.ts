/**
 * Web session routes (M4 #39, ADR-0003) — CLI-approved dashboard sign-in.
 *
 *   POST /v1/web/sessions            start (public): { sessionId, code, expiresAt }
 *   POST /v1/web/sessions/approve    approve by code (device-authenticated CLI)
 *   POST /v1/web/sessions/:id/claim  poll (public): pending | ready(token) | ...
 *
 * The token is minted at claim time and released exactly once. All three
 * routes sit behind the tight per-IP auth rate limit (app.ts).
 */

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AuditService } from "../../domain/audit.js";
import type { MagicLinkService } from "../../domain/magic-links.js";
import type { WebSessionService } from "../../domain/web-sessions.js";
import type { AppEnv } from "../authz.js";
import { notFound } from "../errors.js";
import { parseBody } from "../validate.js";

export interface WebSessionRouteDeps {
  webSessions: WebSessionService;
  audit: AuditService;
  magicLinks: MagicLinkService;
}

const approveSchema = z.object({ code: z.string().min(4).max(32) });
const magicStartSchema = z.object({ email: z.string().email() });
const magicClaimSchema = z.object({ token: z.string().min(16).max(128) });

export function registerWebSessionRoutes(
  app: Hono<AppEnv>,
  deps: WebSessionRouteDeps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  // Magic links (#68): a sign-in link by email, for members with a device.
  // The response NEVER reveals whether the email exists.
  app.post("/v1/web/magic", async (c) => {
    const { email } = await parseBody(c, magicStartSchema);
    await deps.magicLinks.start(email);
    return c.json({ ok: true }, 202);
  });

  app.post("/v1/web/magic/claim", async (c) => {
    const { token } = await parseBody(c, magicClaimSchema);
    const claim = await deps.magicLinks.claim(token);
    if (!claim) throw notFound("that sign-in link is unknown, used, or expired");
    return c.json({ ...claim, expiresAt: claim.expiresAt.toISOString() });
  });

  app.post("/v1/web/sessions", async (c) => {
    const { sessionId, code, expiresAt } = await deps.webSessions.start();
    return c.json({ sessionId, code, expiresAt: expiresAt.toISOString() }, 201);
  });

  app.post("/v1/web/sessions/approve", auth, async (c) => {
    const { code } = await parseBody(c, approveSchema);
    const principal = c.get("principal");
    const result = await deps.webSessions.approve(code, {
      memberId: principal.memberId,
      deviceId: principal.deviceId,
      workspaceId: principal.scope.workspaceId,
      role: principal.scope.role,
    });
    if (result !== "ok") {
      // One message for unknown/expired/used codes; don't help a guesser.
      throw notFound("code not found or expired");
    }
    await deps.audit.record({
      workspaceId: principal.scope.workspaceId,
      actorMemberId: principal.memberId,
      actorDeviceId: principal.deviceId,
      action: "web.session.approve",
      targetType: "workspace",
      targetId: principal.scope.workspaceId,
      outcome: "allowed",
      metadata: {},
    });
    return c.body(null, 204);
  });

  app.post("/v1/web/sessions/:id/claim", async (c) => {
    const result = await deps.webSessions.claim(c.req.param("id"));
    if (!result) throw notFound("session not found");
    if (result.status === "ready") {
      return c.json({
        status: "ready",
        token: result.token,
        expiresAt: result.expiresAt.toISOString(),
        workspaceId: result.workspaceId,
        memberId: result.memberId,
        role: result.role,
      });
    }
    return c.json({ status: result.status });
  });
}
