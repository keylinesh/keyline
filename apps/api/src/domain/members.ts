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
  /** All memberships for an email across workspaces, newest first (#68). */
  findByEmailAnywhere(email: string): Promise<Member[]>;
  listByWorkspace(workspaceId: string): Promise<Member[]>;
  /** Update the display name (profile settings, #43). Null clears it. */
  updateDisplayName(id: string, displayName: string | null): Promise<Member | null>;
  delete(id: string): Promise<boolean>;
}
