/**
 * Resource hierarchy: workspace → project → environment.
 *
 * Repository interfaces only; in-memory implementations live in memory-repo.ts
 * and pg-backed ones in pg-repo.ts. None of these hold secret material — a
 * workspace carries only its (non-secret) KDF salt.
 */

/** Set by the billing layer only (M5); limits per plan live in entitlements.ts. */
export type WorkspacePlan = "solo" | "team_free" | "team";

export interface Workspace {
  id: string;
  name: string;
  /** base64 scrypt salt (not secret). */
  kdfSalt: string;
  plan: WorkspacePlan;
  createdAt: Date;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  createdAt: Date;
}

export interface Environment {
  id: string;
  projectId: string;
  name: string;
  createdAt: Date;
}

export interface WorkspaceRepo {
  /** New workspaces start on the free solo plan. */
  create(input: { name: string; kdfSalt: string }): Promise<Workspace>;
  findById(id: string): Promise<Workspace | null>;
  update(id: string, patch: { name?: string; plan?: WorkspacePlan }): Promise<Workspace | null>;
  delete(id: string): Promise<boolean>;
}

export interface ProjectRepo {
  create(input: { workspaceId: string; name: string; slug: string }): Promise<Project>;
  findById(id: string): Promise<Project | null>;
  listByWorkspace(workspaceId: string): Promise<Project[]>;
  /** Used to enforce a unique slug per workspace before insert. */
  findBySlug(workspaceId: string, slug: string): Promise<Project | null>;
  update(id: string, patch: { name?: string; slug?: string }): Promise<Project | null>;
  delete(id: string): Promise<boolean>;
}

export interface EnvironmentRepo {
  create(input: { projectId: string; name: string }): Promise<Environment>;
  findById(id: string): Promise<Environment | null>;
  listByProject(projectId: string): Promise<Environment[]>;
  findByName(projectId: string, name: string): Promise<Environment | null>;
  update(id: string, patch: { name?: string }): Promise<Environment | null>;
  delete(id: string): Promise<boolean>;
}
