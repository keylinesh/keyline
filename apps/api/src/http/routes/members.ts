/**
 * Member management + per-environment access control (#23).
 *
 *   POST   /v1/workspaces/:wid/members         invite a member        (workspace admin)
 *   GET    /v1/workspaces/:wid/members         list members           (workspace member)
 *   DELETE /v1/members/:id                     remove a member        (workspace admin)
 *   PUT    /v1/environments/:id/access         grant an env role      (env admin)
 *   GET    /v1/environments/:id/access         list env grants        (env admin)
 *   DELETE /v1/environments/:id/access/:mid    revoke an env grant    (env admin)
 *
 * "env admin" = workspace owner/admin (implicit) or a member granted admin on
 * that environment (see access-control.ts).
 */

import type { Context, Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { EnvironmentAccessRepo, EnvAccess } from "../../domain/access.js";
import type { AuditService } from "../../domain/audit.js";
import type { EntitlementsService } from "../../domain/entitlements.js";
import type { JoinService } from "../../domain/join-codes.js";
import type { Member, MemberRepo } from "../../domain/members.js";
import type { EnvironmentRepo, ProjectRepo } from "../../domain/resources.js";
import type { RevokeService } from "../../services/revoke.js";
import { effectiveEnvRole } from "../access-control.js";
import { type AppEnv, requireRole, requireWorkspace } from "../authz.js";
import { conflict, forbidden, notFound, planLimit } from "../errors.js";
import { parseBody } from "../validate.js";

export interface MemberRouteDeps {
  members: MemberRepo;
  access: EnvironmentAccessRepo;
  projects: ProjectRepo;
  environments: EnvironmentRepo;
  audit: AuditService;
  revoke: RevokeService;
  entitlements: EntitlementsService;
  join: JoinService;
}

const workspaceRole = z.enum(["owner", "admin", "member"]);
const envRole = z.enum(["read", "write", "admin"]);

const inviteSchema = z.object({
  email: z.string().email(),
  role: workspaceRole,
  displayName: z.string().min(1).max(120).optional(),
});
const grantSchema = z.object({ memberId: z.string().uuid(), role: envRole });

const memberView = (m: Member) => ({
  id: m.id,
  email: m.email,
  displayName: m.displayName,
  role: m.role,
  createdAt: m.createdAt.toISOString(),
});
const accessView = (a: EnvAccess) => ({
  memberId: a.memberId,
  environmentId: a.environmentId,
  role: a.role,
  createdAt: a.createdAt.toISOString(),
});

export function registerMemberRoutes(
  app: Hono<AppEnv>,
  deps: MemberRouteDeps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  const { members, access, projects, environments, audit, revoke, entitlements, join } = deps;

  // Resolve env -> workspace and require the caller to be an env admin there.
  async function requireEnvAdmin(c: Context<AppEnv>, envId: string) {
    const env = await environments.findById(envId);
    if (!env) throw notFound("environment not found");
    const project = await projects.findById(env.projectId);
    if (!project) throw notFound("environment not found");
    const principal = c.get("principal");
    requireWorkspace(principal, project.workspaceId);
    const role = await effectiveEnvRole(principal, env.id, access);
    if (role !== "admin") throw forbidden("requires admin on this environment");
    return { env, workspaceId: project.workspaceId };
  }

  // ---- Member management ----
  app.post("/v1/workspaces/:wid/members", auth, async (c) => {
    const wid = c.req.param("wid");
    requireWorkspace(c.get("principal"), wid);
    requireRole(c.get("principal"), "admin");
    const input = await parseBody(c, inviteSchema);
    if (await members.findByEmail(wid, input.email)) throw conflict("email already a member");
    const seat = await entitlements.canAddMember(wid);
    if (!seat.allowed) {
      throw planLimit(seat.message, { plan: seat.plan, limit: seat.limit, current: seat.current });
    }
    const m = await members.create({ workspaceId: wid, ...input });
    // The invite's join code (#66): shown once to the admin, stored hashed.
    const joinCode = await join.issue(m.id);
    await audit.record({
      workspaceId: wid,
      actorMemberId: c.get("principal").memberId,
      actorDeviceId: c.get("principal").deviceId,
      action: "member.invite",
      targetType: "member",
      targetId: m.id,
      outcome: "allowed",
      metadata: { email: m.email, role: m.role },
    });
    return c.json(
      { ...memberView(m), joinCode: joinCode.code, joinCodeExpiresAt: joinCode.expiresAt.toISOString() },
      201,
    );
  });

  // Regenerate an invited member's join code (#66). Admin-only; the new code
  // replaces the old one, so a leaked code is one click from dead.
  app.post("/v1/members/:id/join-code", auth, async (c) => {
    const member = await members.findById(c.req.param("id"));
    if (!member) throw notFound("member not found");
    requireWorkspace(c.get("principal"), member.workspaceId);
    requireRole(c.get("principal"), "admin");
    const issued = await join.issue(member.id);
    await audit.record({
      workspaceId: member.workspaceId,
      actorMemberId: c.get("principal").memberId,
      actorDeviceId: c.get("principal").deviceId,
      action: "member.join_code",
      targetType: "member",
      targetId: member.id,
      outcome: "allowed",
      metadata: { email: member.email },
    });
    return c.json({ joinCode: issued.code, joinCodeExpiresAt: issued.expiresAt.toISOString() });
  });

  app.get("/v1/workspaces/:wid/members", auth, async (c) => {
    const wid = c.req.param("wid");
    requireWorkspace(c.get("principal"), wid);
    requireRole(c.get("principal"), "member");
    const list = await members.listByWorkspace(wid);
    return c.json({ members: list.map(memberView) });
  });

  // Profile settings (#43): a member edits their own display name; admins can
  // edit anyone's. Email and role are NOT editable here (role changes are a
  // deliberate future decision; email is the identity).
  app.patch("/v1/members/:id", auth, async (c) => {
    const member = await members.findById(c.req.param("id"));
    if (!member) throw notFound("member not found");
    const principal = c.get("principal");
    requireWorkspace(principal, member.workspaceId);
    const isSelf = principal.memberId === member.id;
    const isAdmin = principal.scope.role === "admin" || principal.scope.role === "owner";
    if (!isSelf && !isAdmin) throw forbidden("you can only edit your own profile");
    const input = await parseBody(
      c,
      z.object({ displayName: z.string().min(1).max(120).nullable() }),
    );
    const updated = await members.updateDisplayName(member.id, input.displayName);
    if (!updated) throw notFound("member not found");
    return c.json(memberView(updated));
  });

  app.delete("/v1/members/:id", auth, async (c) => {
    const member = await members.findById(c.req.param("id"));
    if (!member) throw notFound("member not found");
    requireWorkspace(c.get("principal"), member.workspaceId);
    requireRole(c.get("principal"), "admin");
    await members.delete(member.id);
    await audit.record({
      workspaceId: member.workspaceId,
      actorMemberId: c.get("principal").memberId,
      actorDeviceId: c.get("principal").deviceId,
      action: "member.remove",
      targetType: "member",
      targetId: member.id,
      outcome: "allowed",
    });
    return c.body(null, 204);
  });

  // Revoke a member's access immediately (keeps the member + ciphertext, drops
  // their tokens and wrapped keys). #25.
  app.post("/v1/members/:id/revoke", auth, async (c) => {
    const member = await members.findById(c.req.param("id"));
    if (!member) throw notFound("member not found");
    requireWorkspace(c.get("principal"), member.workspaceId);
    requireRole(c.get("principal"), "admin");
    const result = await revoke.revokeMember(member.workspaceId, member.id);
    await audit.record({
      workspaceId: member.workspaceId,
      actorMemberId: c.get("principal").memberId,
      actorDeviceId: c.get("principal").deviceId,
      action: "member.revoke",
      targetType: "member",
      targetId: member.id,
      outcome: "allowed",
      metadata: { ...result },
    });
    return c.json(result);
  });

  // ---- Per-environment access ----
  app.put("/v1/environments/:id/access", auth, async (c) => {
    const { workspaceId } = await requireEnvAdmin(c, c.req.param("id"));
    const input = await parseBody(c, grantSchema);
    const member = await members.findById(input.memberId);
    if (!member || member.workspaceId !== workspaceId) {
      throw notFound("member not found in this workspace");
    }
    const granted = await access.grant({ environmentId: c.req.param("id"), ...input });
    await audit.record({
      workspaceId,
      actorMemberId: c.get("principal").memberId,
      actorDeviceId: c.get("principal").deviceId,
      action: "access.grant",
      targetType: "environment",
      targetId: c.req.param("id"),
      outcome: "allowed",
      metadata: { memberId: input.memberId, role: input.role },
    });
    return c.json(accessView(granted));
  });

  app.get("/v1/environments/:id/access", auth, async (c) => {
    await requireEnvAdmin(c, c.req.param("id"));
    const list = await access.listByEnvironment(c.req.param("id"));
    return c.json({ access: list.map(accessView) });
  });

  app.delete("/v1/environments/:id/access/:memberId", auth, async (c) => {
    const { workspaceId } = await requireEnvAdmin(c, c.req.param("id"));
    const ok = await access.revoke(c.req.param("id"), c.req.param("memberId"));
    if (!ok) throw notFound("grant not found");
    await audit.record({
      workspaceId,
      actorMemberId: c.get("principal").memberId,
      actorDeviceId: c.get("principal").deviceId,
      action: "access.revoke",
      targetType: "environment",
      targetId: c.req.param("id"),
      outcome: "allowed",
      metadata: { memberId: c.req.param("memberId") },
    });
    return c.body(null, 204);
  });
}
