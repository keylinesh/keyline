/**
 * Authorization middleware + helpers.
 *
 * authMiddleware turns a `Bearer` token into a Principal (via TokenService) and
 * stores it on the context. The require* helpers enforce that a principal's
 * token scope covers the resource's workspace and meets a minimum role.
 */

import { createMiddleware } from "hono/factory";
import type { Role } from "../auth/scope.js";
import type { Principal, TokenService } from "../auth/tokens.js";
import { forbidden, unauthorized } from "./errors.js";

export type AppEnv = { Variables: { principal: Principal } };

export function authMiddleware(tokens: TokenService) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const header = c.req.header("authorization");
    if (!header || !header.startsWith("Bearer ")) throw unauthorized();
    const principal = await tokens.verify(header.slice("Bearer ".length).trim());
    if (!principal) throw unauthorized("invalid or expired token");
    c.set("principal", principal);
    await next();
  });
}

const RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 };

/** The token must be scoped to this workspace. */
export function requireWorkspace(principal: Principal, workspaceId: string): void {
  if (principal.scope.workspaceId !== workspaceId) {
    throw forbidden("token is not scoped to this workspace");
  }
}

/** The principal's role must be at least `min`. */
export function requireRole(principal: Principal, min: Role): void {
  if (RANK[principal.scope.role] < RANK[min]) {
    throw forbidden(`this action requires the ${min} role`);
  }
}
