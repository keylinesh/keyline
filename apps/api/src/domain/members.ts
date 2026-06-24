/**
 * Members — people in a workspace. Identity + workspace role only; no secrets.
 */

import type { Role } from "../auth/scope.js";

export interface Member {
  id: string;
  workspaceId: string;
  email: string;
  displayName: string | null;
  role: Role;
  createdAt: Date;
}

export interface MemberRepo {
  create(input: {
    workspaceId: string;
    email: string;
    role: Role;
    displayName?: string;
  }): Promise<Member>;
  findById(id: string): Promise<Member | null>;
  findByEmail(workspaceId: string, email: string): Promise<Member | null>;
  listByWorkspace(workspaceId: string): Promise<Member[]>;
  delete(id: string): Promise<boolean>;
}
