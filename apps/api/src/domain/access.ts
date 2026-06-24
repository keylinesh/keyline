/**
 * Per-environment access grants (#23).
 *
 * Independent of the workspace role: a workspace member gets access to an
 * environment only via an explicit grant here. Owners/admins are handled above
 * this layer (see http/access-control.ts) and implicitly have admin everywhere.
 */

export type EnvRole = "read" | "write" | "admin";

export interface EnvAccess {
  id: string;
  environmentId: string;
  memberId: string;
  role: EnvRole;
  createdAt: Date;
}

export interface EnvironmentAccessRepo {
  /** Insert or update a member's role on an environment. */
  grant(input: { environmentId: string; memberId: string; role: EnvRole }): Promise<EnvAccess>;
  get(memberId: string, environmentId: string): Promise<EnvAccess | null>;
  listByEnvironment(environmentId: string): Promise<EnvAccess[]>;
  revoke(environmentId: string, memberId: string): Promise<boolean>;
}
