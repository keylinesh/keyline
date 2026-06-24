/**
 * Postgres-backed resource repositories (schema from migration 0001).
 * Exercised once a database is provisioned (#27); kept honest by typecheck.
 */

import type { Pool } from "pg";
import type {
  Environment,
  EnvironmentRepo,
  Project,
  ProjectRepo,
  Workspace,
  WorkspaceRepo,
} from "./resources.js";

export class PgWorkspaceRepo implements WorkspaceRepo {
  constructor(private readonly pool: Pool) {}

  async create(input: { name: string; kdfSalt: string }): Promise<Workspace> {
    const { rows } = await this.pool.query<{ id: string; created_at: Date }>(
      `insert into workspaces (name, kdf_salt) values ($1, $2) returning id, created_at`,
      [input.name, input.kdfSalt],
    );
    const r = rows[0]!;
    return { id: r.id, name: input.name, kdfSalt: input.kdfSalt, createdAt: r.created_at };
  }
  async findById(id: string): Promise<Workspace | null> {
    const { rows } = await this.pool.query<{ id: string; name: string; kdf_salt: string; created_at: Date }>(
      `select id, name, kdf_salt, created_at from workspaces where id = $1`,
      [id],
    );
    const r = rows[0];
    return r ? { id: r.id, name: r.name, kdfSalt: r.kdf_salt, createdAt: r.created_at } : null;
  }
  async update(id: string, patch: { name?: string }): Promise<Workspace | null> {
    const { rows } = await this.pool.query<{ id: string; name: string; kdf_salt: string; created_at: Date }>(
      `update workspaces set name = coalesce($2, name), updated_at = now()
       where id = $1 returning id, name, kdf_salt, created_at`,
      [id, patch.name ?? null],
    );
    const r = rows[0];
    return r ? { id: r.id, name: r.name, kdfSalt: r.kdf_salt, createdAt: r.created_at } : null;
  }
  async delete(id: string): Promise<boolean> {
    const res = await this.pool.query(`delete from workspaces where id = $1`, [id]);
    return (res.rowCount ?? 0) > 0;
  }
}

interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  created_at: Date;
}
const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  workspaceId: r.workspace_id,
  name: r.name,
  slug: r.slug,
  createdAt: r.created_at,
});

export class PgProjectRepo implements ProjectRepo {
  constructor(private readonly pool: Pool) {}

  async create(input: { workspaceId: string; name: string; slug: string }): Promise<Project> {
    const { rows } = await this.pool.query<ProjectRow>(
      `insert into projects (workspace_id, name, slug) values ($1, $2, $3)
       returning id, workspace_id, name, slug, created_at`,
      [input.workspaceId, input.name, input.slug],
    );
    return toProject(rows[0]!);
  }
  async findById(id: string): Promise<Project | null> {
    const { rows } = await this.pool.query<ProjectRow>(
      `select id, workspace_id, name, slug, created_at from projects where id = $1`,
      [id],
    );
    return rows[0] ? toProject(rows[0]) : null;
  }
  async listByWorkspace(workspaceId: string): Promise<Project[]> {
    const { rows } = await this.pool.query<ProjectRow>(
      `select id, workspace_id, name, slug, created_at from projects
       where workspace_id = $1 order by created_at`,
      [workspaceId],
    );
    return rows.map(toProject);
  }
  async findBySlug(workspaceId: string, slug: string): Promise<Project | null> {
    const { rows } = await this.pool.query<ProjectRow>(
      `select id, workspace_id, name, slug, created_at from projects
       where workspace_id = $1 and slug = $2`,
      [workspaceId, slug],
    );
    return rows[0] ? toProject(rows[0]) : null;
  }
  async update(id: string, patch: { name?: string; slug?: string }): Promise<Project | null> {
    const { rows } = await this.pool.query<ProjectRow>(
      `update projects set name = coalesce($2, name), slug = coalesce($3, slug)
       where id = $1 returning id, workspace_id, name, slug, created_at`,
      [id, patch.name ?? null, patch.slug ?? null],
    );
    return rows[0] ? toProject(rows[0]) : null;
  }
  async delete(id: string): Promise<boolean> {
    const res = await this.pool.query(`delete from projects where id = $1`, [id]);
    return (res.rowCount ?? 0) > 0;
  }
}

interface EnvRow {
  id: string;
  project_id: string;
  name: string;
  created_at: Date;
}
const toEnv = (r: EnvRow): Environment => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  createdAt: r.created_at,
});

export class PgEnvironmentRepo implements EnvironmentRepo {
  constructor(private readonly pool: Pool) {}

  async create(input: { projectId: string; name: string }): Promise<Environment> {
    const { rows } = await this.pool.query<EnvRow>(
      `insert into environments (project_id, name) values ($1, $2)
       returning id, project_id, name, created_at`,
      [input.projectId, input.name],
    );
    return toEnv(rows[0]!);
  }
  async findById(id: string): Promise<Environment | null> {
    const { rows } = await this.pool.query<EnvRow>(
      `select id, project_id, name, created_at from environments where id = $1`,
      [id],
    );
    return rows[0] ? toEnv(rows[0]) : null;
  }
  async listByProject(projectId: string): Promise<Environment[]> {
    const { rows } = await this.pool.query<EnvRow>(
      `select id, project_id, name, created_at from environments
       where project_id = $1 order by created_at`,
      [projectId],
    );
    return rows.map(toEnv);
  }
  async findByName(projectId: string, name: string): Promise<Environment | null> {
    const { rows } = await this.pool.query<EnvRow>(
      `select id, project_id, name, created_at from environments
       where project_id = $1 and name = $2`,
      [projectId, name],
    );
    return rows[0] ? toEnv(rows[0]) : null;
  }
  async update(id: string, patch: { name?: string }): Promise<Environment | null> {
    const { rows } = await this.pool.query<EnvRow>(
      `update environments set name = coalesce($2, name)
       where id = $1 returning id, project_id, name, created_at`,
      [id, patch.name ?? null],
    );
    return rows[0] ? toEnv(rows[0]) : null;
  }
  async delete(id: string): Promise<boolean> {
    const res = await this.pool.query(`delete from environments where id = $1`, [id]);
    return (res.rowCount ?? 0) > 0;
  }
}
