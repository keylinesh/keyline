/**
 * Access scope — what a token is allowed to touch.
 *
 * A token is bound to one workspace and a role, and may be further restricted to
 * a set of environments (least privilege). environmentIds === undefined means
 * "not restricted at this layer"; the per-environment RBAC check lands in #23.
 */

export type Role = "owner" | "admin" | "member";

export interface Scope {
  workspaceId: string;
  role: Role;
  /** undefined = all environments the role permits; otherwise restricted to these. */
  environmentIds?: string[];
}

/** Whether a scope permits acting on a given environment. */
export function scopeAllowsEnvironment(scope: Scope, environmentId: string): boolean {
  return scope.environmentIds === undefined || scope.environmentIds.includes(environmentId);
}
