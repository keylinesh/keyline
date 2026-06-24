/**
 * Push / pull encrypted secret bundles (#22) — the core data path.
 *
 *   PUT  /v1/environments/:id/bundle  → append a new ciphertext version
 *   GET  /v1/environments/:id/bundle  → latest ciphertext + this device's wrapped key
 *
 * The server only ever sees ciphertext. Push supports optimistic concurrency via
 * `baseVersion`: if the client's base is no longer the latest, the push is a 409
 * and nothing is clobbered.
 */

import type { Context, Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import { scopeAllowsEnvironment } from "../../auth/scope.js";
import type { EnvironmentAccessRepo } from "../../domain/access.js";
import {
  type BundleRepo,
  VersionConflictError,
  type WrappedKeyRepo,
} from "../../domain/bundles.js";
import type { EnvironmentRepo, ProjectRepo } from "../../domain/resources.js";
import { effectiveEnvRole, meetsEnv } from "../access-control.js";
import { type AppEnv, requireWorkspace } from "../authz.js";
import { ApiError, forbidden, notFound } from "../errors.js";
import { parseBody } from "../validate.js";

export interface BundleDeps {
  bundles: BundleRepo;
  wrappedKeys: WrappedKeyRepo;
  access: EnvironmentAccessRepo;
  projects: ProjectRepo;
  environments: EnvironmentRepo;
}

const b64 = z.string().min(1);
const pushSchema = z.object({
  bundle: z.object({
    v: z.number().int().positive(),
    nonce: b64,
    ciphertext: b64,
    tag: b64,
  }),
  baseVersion: z.number().int().nonnegative().optional(),
});

export function registerBundleRoutes(
  app: Hono<AppEnv>,
  deps: BundleDeps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  const { bundles, wrappedKeys, access: accessRepo, projects, environments } = deps;

  // Resolve the environment; assert the token covers its workspace, the env is in
  // token scope, and the member's effective environment role meets `need`.
  async function access(c: Context<AppEnv>, envId: string, need: "read" | "write") {
    const env = await environments.findById(envId);
    if (!env) throw notFound("environment not found");
    const project = await projects.findById(env.projectId);
    if (!project) throw notFound("environment not found");
    const principal = c.get("principal");
    requireWorkspace(principal, project.workspaceId);
    if (!scopeAllowsEnvironment(principal.scope, env.id)) {
      throw forbidden("token is not scoped to this environment");
    }
    const role = await effectiveEnvRole(principal, env.id, accessRepo);
    if (!meetsEnv(role, need)) throw forbidden(`requires ${need} access to this environment`);
    return { env, workspaceId: project.workspaceId, principal };
  }

  app.put("/v1/environments/:id/bundle", auth, async (c) => {
    const { env, principal } = await access(c, c.req.param("id"), "write");
    const { bundle, baseVersion } = await parseBody(c, pushSchema);
    try {
      const stored = await bundles.append({
        environmentId: env.id,
        baseVersion,
        formatVersion: bundle.v,
        nonce: bundle.nonce,
        ciphertext: bundle.ciphertext,
        tag: bundle.tag,
        createdByDeviceId: principal.deviceId,
      });
      return c.json({ version: stored.version, createdAt: stored.createdAt.toISOString() }, 201);
    } catch (err) {
      if (err instanceof VersionConflictError) {
        throw new ApiError(409, "conflict", err.message, { currentVersion: err.currentVersion });
      }
      throw err;
    }
  });

  app.get("/v1/environments/:id/bundle", auth, async (c) => {
    const { env, workspaceId, principal } = await access(c, c.req.param("id"), "read");
    const latest = await bundles.getLatest(env.id);
    if (!latest) throw notFound("no bundle has been pushed for this environment yet");

    const wk = await wrappedKeys.findForDevice(workspaceId, principal.deviceId);
    return c.json({
      bundle: {
        version: latest.version,
        v: latest.formatVersion,
        nonce: latest.nonce,
        ciphertext: latest.ciphertext,
        tag: latest.tag,
        createdAt: latest.createdAt.toISOString(),
      },
      // null means this device has no wrapped workspace key yet (granted via #23/#25).
      wrappedKey: wk
        ? { v: wk.formatVersion, eph: wk.eph, nonce: wk.nonce, ct: wk.ct, tag: wk.tag }
        : null,
    });
  });
}
