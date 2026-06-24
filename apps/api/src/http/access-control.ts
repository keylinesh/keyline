/**
 * Effective per-environment role resolution.
 *
 * Owners and workspace admins implicitly have `admin` on every environment.
 * A plain member's role on an environment is whatever was explicitly granted
 * (environment_access), or none. capabilities: read = pull, write = pull+push,
 * admin = pull+push+manage access.
 */

import type { Principal } from "../auth/tokens.js";
import type { EnvironmentAccessRepo, EnvRole } from "../domain/access.js";

const RANK: Record<EnvRole, number> = { read: 0, write: 1, admin: 2 };

export async function effectiveEnvRole(
  principal: Principal,
  environmentId: string,
  access: EnvironmentAccessRepo,
): Promise<EnvRole | null> {
  if (principal.scope.role === "owner" || principal.scope.role === "admin") return "admin";
  const grant = await access.get(principal.memberId, environmentId);
  return grant?.role ?? null;
}

/** True if `role` meets or exceeds the minimum required capability. */
export function meetsEnv(role: EnvRole | null, min: EnvRole): boolean {
  return role !== null && RANK[role] >= RANK[min];
}
