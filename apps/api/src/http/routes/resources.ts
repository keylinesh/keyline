/**
 * CRUD for the resource hierarchy: workspaces, projects, environments (#21).
 *
 * Every route requires a valid token. Authorization: the token must be scoped to
 * the resource's workspace (requireWorkspace), and writes require an elevated
 * role (admin for create/update/delete; owner to delete a workspace). Project
 * and environment routes load the resource first to resolve its workspace.
 */

import type { Context, Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type {
  Environment,
  EnvironmentRepo,
  Project,
  ProjectRepo,
  Workspace,
  WorkspaceRepo,
} from "../../domain/resources.js";
import type { AuditService } from "../../domain/audit.js";
import type { EntitlementsService } from "../../domain/entitlements.js";
import { type AppEnv, requireRole, requireWorkspace } from "../authz.js";
import { conflict, notFound, planLimit } from "../errors.js";
import { parseBody } from "../validate.js";

export interface ResourceDeps {
  workspaces: WorkspaceRepo;
  projects: ProjectRepo;
  environments: EnvironmentRepo;
  entitlements: EntitlementsService;
  audit: AuditService;
}

const name = z.string().min(1).max(120);
const slug = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be lowercase alphanumeric with single hyphens");

const workspaceCreate = z.object({ name, kdfSalt: z.string().min(1) });
const workspaceUpdate = z.object({ name });
const projectCreate = z.object({ name, slug });
const projectUpdate = z.object({ name: name.optional(), slug: slug.optional() }).refine(
  (v) => v.name !== undefined || v.slug !== undefined,
  { message: "provide at least one field to update" },
);
const envCreate = z.object({ name });
const envUpdate = z.object({ name });

const wsView = (w: Workspace) => ({
  id: w.id,
  name: w.name,
  kdfSalt: w.kdfSalt,
  plan: w.plan,
  createdAt: w.createdAt.toISOString(),
});
const projView = (p: Project) => ({
  id: p.id,
  workspaceId: p.workspaceId,
  name: p.name,
  slug: p.slug,
  createdAt: p.createdAt.toISOString(),
});
const envView = (e: Environment) => ({
  id: e.id,
  projectId: e.projectId,
  name: e.name,
  createdAt: e.createdAt.toISOString(),
});

export function registerResourceRoutes(
  app: Hono<AppEnv>,
  deps: ResourceDeps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  const { workspaces, projects, environments, entitlements, audit } = deps;

  // Load a project and assert the caller's token covers its workspace.
  async function loadProject(c: Context<AppEnv>, id: string) {
    const project = await projects.findById(id);
    if (!project) throw notFound("project not found");
    requireWorkspace(c.get("principal"), project.workspaceId);
    return project;
  }
  async function loadEnvironment(c: Context<AppEnv>, id: string) {
    const env = await environments.findById(id);
    if (!env) throw notFound("environment not found");
    const project = await projects.findById(env.projectId);
    if (!project) throw notFound("environment not found");
    requireWorkspace(c.get("principal"), project.workspaceId);
    return { env, project };
  }

  // ---- Workspaces ----
  // Create is the onboarding seam: linking the caller as the owner member lands
  // with signup/#23. For now any authenticated principal may create one.
  app.post("/v1/workspaces", auth, async (c) => {
    const input = await parseBody(c, workspaceCreate);
    const w = await workspaces.create(input);
    return c.json(wsView(w), 201);
  });

  app.get("/v1/workspaces", auth, async (c) => {
    const w = await workspaces.findById(c.get("principal").scope.workspaceId);
    return c.json({ workspaces: w ? [wsView(w)] : [] });
  });

  app.get("/v1/workspaces/:id", auth, async (c) => {
    const id = c.req.param("id");
    requireWorkspace(c.get("principal"), id);
    const w = await workspaces.findById(id);
    if (!w) throw notFound("workspace not found");
    return c.json(wsView(w));
  });

  app.patch("/v1/workspaces/:id", auth, async (c) => {
    const id = c.req.param("id");
    requireWorkspace(c.get("principal"), id);
    requireRole(c.get("principal"), "admin");
    const patch = await parseBody(c, workspaceUpdate);
    const w = await workspaces.update(id, patch);
    if (!w) throw notFound("workspace not found");
    return c.json(wsView(w));
  });

  // Free self-serve plan switch (M7 #87): solo <-> team_free only. Paid
  // transitions happen exclusively through billing webhooks/reconciliation,
  // so this endpoint can never grant what wasn't paid for.
  app.patch("/v1/workspaces/:id/plan", auth, async (c) => {
    const id = c.req.param("id");
    const principal = c.get("principal");
    requireWorkspace(principal, id);
    requireRole(principal, "owner");
    const { plan } = await parseBody(c, z.object({ plan: z.enum(["solo", "team_free"]) }));
    const current = await workspaces.findById(id);
    if (!current) throw notFound("workspace not found");
    if (current.plan === "team") {
      throw conflict("Team is a paid plan. Manage it in billing, not here.");
    }
    const w = await workspaces.update(id, { plan });
    await audit.record({
      workspaceId: id,
      actorMemberId: principal.memberId,
      actorDeviceId: principal.deviceId,
      action: "plan.change",
      targetType: "workspace",
      targetId: id,
      outcome: "allowed",
      metadata: { from: current.plan, to: plan },
    });
    return c.json(wsView(w!));
  });

  app.delete("/v1/workspaces/:id", auth, async (c) => {
    const id = c.req.param("id");
    requireWorkspace(c.get("principal"), id);
    requireRole(c.get("principal"), "owner");
    const ok = await workspaces.delete(id);
    if (!ok) throw notFound("workspace not found");
    return c.body(null, 204);
  });

  // ---- Projects ----
  app.post("/v1/workspaces/:wid/projects", auth, async (c) => {
    const wid = c.req.param("wid");
    requireWorkspace(c.get("principal"), wid);
    requireRole(c.get("principal"), "admin");
    const input = await parseBody(c, projectCreate);
    if (await projects.findBySlug(wid, input.slug)) throw conflict("slug already in use");
    const p = await projects.create({ workspaceId: wid, ...input });
    return c.json(projView(p), 201);
  });

  app.get("/v1/workspaces/:wid/projects", auth, async (c) => {
    const wid = c.req.param("wid");
    requireWorkspace(c.get("principal"), wid);
    const list = await projects.listByWorkspace(wid);
    // Environments ride along so the Projects page is one request instead of
    // one per project. Additive; older clients ignore the extra field.
    return c.json({
      projects: await Promise.all(
        list.map(async (p) => ({
          ...projView(p),
          environments: (await environments.listByProject(p.id)).map(envView),
        })),
      ),
    });
  });

  app.get("/v1/projects/:id", auth, async (c) => {
    const p = await loadProject(c, c.req.param("id"));
    return c.json(projView(p));
  });

  app.patch("/v1/projects/:id", auth, async (c) => {
    const p = await loadProject(c, c.req.param("id"));
    requireRole(c.get("principal"), "admin");
    const patch = await parseBody(c, projectUpdate);
    if (patch.slug && patch.slug !== p.slug && (await projects.findBySlug(p.workspaceId, patch.slug))) {
      throw conflict("slug already in use");
    }
    const updated = await projects.update(p.id, patch);
    return c.json(projView(updated!));
  });

  app.delete("/v1/projects/:id", auth, async (c) => {
    const p = await loadProject(c, c.req.param("id"));
    requireRole(c.get("principal"), "admin");
    await projects.delete(p.id);
    return c.body(null, 204);
  });

  // ---- Environments ----
  app.post("/v1/projects/:pid/environments", auth, async (c) => {
    const project = await loadProject(c, c.req.param("pid"));
    requireRole(c.get("principal"), "admin");
    const input = await parseBody(c, envCreate);
    if (await environments.findByName(project.id, input.name)) {
      throw conflict("environment name already in use");
    }
    const cap = await entitlements.canCreateEnvironment(project.workspaceId);
    if (!cap.allowed) {
      throw planLimit(cap.message, { plan: cap.plan, limit: cap.limit, current: cap.current });
    }
    const e = await environments.create({ projectId: project.id, name: input.name });
    return c.json(envView(e), 201);
  });

  app.get("/v1/projects/:pid/environments", auth, async (c) => {
    const project = await loadProject(c, c.req.param("pid"));
    const list = await environments.listByProject(project.id);
    return c.json({ environments: list.map(envView) });
  });

  app.get("/v1/environments/:id", auth, async (c) => {
    const { env } = await loadEnvironment(c, c.req.param("id"));
    return c.json(envView(env));
  });

  app.patch("/v1/environments/:id", auth, async (c) => {
    const { env, project } = await loadEnvironment(c, c.req.param("id"));
    requireRole(c.get("principal"), "admin");
    const patch = await parseBody(c, envUpdate);
    if (patch.name !== env.name && (await environments.findByName(project.id, patch.name))) {
      throw conflict("environment name already in use");
    }
    const updated = await environments.update(env.id, patch);
    return c.json(envView(updated!));
  });

  app.delete("/v1/environments/:id", auth, async (c) => {
    const { env } = await loadEnvironment(c, c.req.param("id"));
    requireRole(c.get("principal"), "admin");
    await environments.delete(env.id);
    return c.body(null, 204);
  });
}
