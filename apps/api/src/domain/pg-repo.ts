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
import {
  type AppendBundleInput,
  type BundleRepo,
  type StoredBundle,
  type StoredWrappedKey,
  VersionConflictError,
  type WrappedKeyRepo,
} from "./bundles.js";
import type { Member, MemberRepo } from "./members.js";
import type { EnvAccess, EnvironmentAccessRepo, EnvRole } from "./access.js";
import {
  type AppendAuditInput,
  type AuditEvent,
  type AuditOutcome,
  type AuditRepo,
  computeEventHash,
  GENESIS_HASH,
} from "./audit.js";
import type { Role } from "../auth/scope.js";

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

interface BundleRow {
  id: string;
  environment_id: string;
  version: number;
  format_version: number;
  nonce: string;
  ciphertext: string;
  tag: string;
  created_by_device_id: string | null;
  created_at: Date;
}
const toBundle = (r: BundleRow): StoredBundle => ({
  id: r.id,
  environmentId: r.environment_id,
  version: r.version,
  formatVersion: r.format_version,
  nonce: r.nonce,
  ciphertext: r.ciphertext,
  tag: r.tag,
  createdByDeviceId: r.created_by_device_id,
  createdAt: r.created_at,
});

export class PgBundleRepo implements BundleRepo {
  constructor(private readonly pool: Pool) {}

  async getLatest(environmentId: string): Promise<StoredBundle | null> {
    const { rows } = await this.pool.query<BundleRow>(
      `select id, environment_id, version, format_version, nonce, ciphertext, tag,
              created_by_device_id, created_at
         from secret_bundles
        where environment_id = $1
        order by version desc
        limit 1`,
      [environmentId],
    );
    return rows[0] ? toBundle(rows[0]) : null;
  }

  async append(input: AppendBundleInput): Promise<StoredBundle> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // Lock concurrent appends for this environment to a single writer.
      const { rows: cur } = await client.query<{ version: number }>(
        `select coalesce(max(version), 0) as version
           from secret_bundles where environment_id = $1 for update`,
        [input.environmentId],
      );
      const current = cur[0]?.version ?? 0;
      if (input.baseVersion !== undefined && input.baseVersion !== current) {
        await client.query("rollback");
        throw new VersionConflictError(current);
      }
      const { rows } = await client.query<BundleRow>(
        `insert into secret_bundles
           (environment_id, version, format_version, nonce, ciphertext, tag, created_by_device_id)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id, environment_id, version, format_version, nonce, ciphertext, tag,
                   created_by_device_id, created_at`,
        [
          input.environmentId,
          current + 1,
          input.formatVersion,
          input.nonce,
          input.ciphertext,
          input.tag,
          input.createdByDeviceId,
        ],
      );
      await client.query("commit");
      return toBundle(rows[0]!);
    } catch (err) {
      await client.query("rollback").catch(() => {});
      // Unique (environment_id, version) violation under a race == a conflict.
      if ((err as { code?: string }).code === "23505") {
        const latest = await this.getLatest(input.environmentId);
        throw new VersionConflictError(latest?.version ?? 0);
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

export class PgWrappedKeyRepo implements WrappedKeyRepo {
  constructor(private readonly pool: Pool) {}

  async findForDevice(workspaceId: string, deviceId: string): Promise<StoredWrappedKey | null> {
    const { rows } = await this.pool.query<{
      workspace_id: string;
      device_id: string;
      format_version: number;
      eph: string;
      nonce: string;
      ct: string;
      tag: string;
    }>(
      `select workspace_id, device_id, format_version, eph, nonce, ct, tag
         from wrapped_keys where workspace_id = $1 and device_id = $2`,
      [workspaceId, deviceId],
    );
    const r = rows[0];
    return r
      ? {
          workspaceId: r.workspace_id,
          deviceId: r.device_id,
          formatVersion: r.format_version,
          eph: r.eph,
          nonce: r.nonce,
          ct: r.ct,
          tag: r.tag,
        }
      : null;
  }

  async upsert(key: StoredWrappedKey): Promise<void> {
    await this.pool.query(
      `insert into wrapped_keys (workspace_id, device_id, format_version, eph, nonce, ct, tag)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (workspace_id, device_id) do update set
         format_version = excluded.format_version,
         eph = excluded.eph, nonce = excluded.nonce, ct = excluded.ct, tag = excluded.tag`,
      [key.workspaceId, key.deviceId, key.formatVersion, key.eph, key.nonce, key.ct, key.tag],
    );
  }
}

interface MemberRow {
  id: string;
  workspace_id: string;
  email: string;
  display_name: string | null;
  role: Role;
  created_at: Date;
}
const toMember = (r: MemberRow): Member => ({
  id: r.id,
  workspaceId: r.workspace_id,
  email: r.email,
  displayName: r.display_name,
  role: r.role,
  createdAt: r.created_at,
});

export class PgMemberRepo implements MemberRepo {
  constructor(private readonly pool: Pool) {}

  async create(input: {
    workspaceId: string;
    email: string;
    role: Role;
    displayName?: string;
  }): Promise<Member> {
    const { rows } = await this.pool.query<MemberRow>(
      `insert into members (workspace_id, email, role, display_name)
       values ($1, $2, $3, $4)
       returning id, workspace_id, email, display_name, role, created_at`,
      [input.workspaceId, input.email, input.role, input.displayName ?? null],
    );
    return toMember(rows[0]!);
  }
  async findById(id: string): Promise<Member | null> {
    const { rows } = await this.pool.query<MemberRow>(
      `select id, workspace_id, email, display_name, role, created_at from members where id = $1`,
      [id],
    );
    return rows[0] ? toMember(rows[0]) : null;
  }
  async findByEmail(workspaceId: string, email: string): Promise<Member | null> {
    const { rows } = await this.pool.query<MemberRow>(
      `select id, workspace_id, email, display_name, role, created_at
         from members where workspace_id = $1 and email = $2`,
      [workspaceId, email],
    );
    return rows[0] ? toMember(rows[0]) : null;
  }
  async listByWorkspace(workspaceId: string): Promise<Member[]> {
    const { rows } = await this.pool.query<MemberRow>(
      `select id, workspace_id, email, display_name, role, created_at
         from members where workspace_id = $1 order by created_at`,
      [workspaceId],
    );
    return rows.map(toMember);
  }
  async delete(id: string): Promise<boolean> {
    const res = await this.pool.query(`delete from members where id = $1`, [id]);
    return (res.rowCount ?? 0) > 0;
  }
}

interface EnvAccessRow {
  id: string;
  environment_id: string;
  member_id: string;
  role: EnvRole;
  created_at: Date;
}
const toEnvAccess = (r: EnvAccessRow): EnvAccess => ({
  id: r.id,
  environmentId: r.environment_id,
  memberId: r.member_id,
  role: r.role,
  createdAt: r.created_at,
});

export class PgEnvironmentAccessRepo implements EnvironmentAccessRepo {
  constructor(private readonly pool: Pool) {}

  async grant(input: { environmentId: string; memberId: string; role: EnvRole }): Promise<EnvAccess> {
    const { rows } = await this.pool.query<EnvAccessRow>(
      `insert into environment_access (environment_id, member_id, role)
       values ($1, $2, $3)
       on conflict (environment_id, member_id) do update set role = excluded.role
       returning id, environment_id, member_id, role, created_at`,
      [input.environmentId, input.memberId, input.role],
    );
    return toEnvAccess(rows[0]!);
  }
  async get(memberId: string, environmentId: string): Promise<EnvAccess | null> {
    const { rows } = await this.pool.query<EnvAccessRow>(
      `select id, environment_id, member_id, role, created_at
         from environment_access where member_id = $1 and environment_id = $2`,
      [memberId, environmentId],
    );
    return rows[0] ? toEnvAccess(rows[0]) : null;
  }
  async listByEnvironment(environmentId: string): Promise<EnvAccess[]> {
    const { rows } = await this.pool.query<EnvAccessRow>(
      `select id, environment_id, member_id, role, created_at
         from environment_access where environment_id = $1 order by created_at`,
      [environmentId],
    );
    return rows.map(toEnvAccess);
  }
  async revoke(environmentId: string, memberId: string): Promise<boolean> {
    const res = await this.pool.query(
      `delete from environment_access where environment_id = $1 and member_id = $2`,
      [environmentId, memberId],
    );
    return (res.rowCount ?? 0) > 0;
  }
}

interface AuditRow {
  id: string;
  workspace_id: string;
  seq: string; // bigint comes back as string
  actor_member_id: string | null;
  actor_device_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: AuditOutcome;
  metadata: Record<string, unknown>;
  prev_hash: string;
  hash: string;
  created_at: Date;
}
const toAudit = (r: AuditRow): AuditEvent => ({
  id: r.id,
  workspaceId: r.workspace_id,
  seq: Number(r.seq),
  actorMemberId: r.actor_member_id,
  actorDeviceId: r.actor_device_id,
  action: r.action,
  targetType: r.target_type,
  targetId: r.target_id,
  outcome: r.outcome,
  metadata: r.metadata,
  prevHash: r.prev_hash,
  hash: r.hash,
  createdAt: r.created_at,
});

export class PgAuditRepo implements AuditRepo {
  constructor(private readonly pool: Pool) {}

  async append(input: AppendAuditInput): Promise<AuditEvent> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // Serialize all appends for this workspace so seq + chain stay consistent.
      await client.query("select 1 from workspaces where id = $1 for update", [input.workspaceId]);
      const { rows: headRows } = await client.query<{ seq: string; hash: string }>(
        `select seq, hash from audit_events where workspace_id = $1 order by seq desc limit 1`,
        [input.workspaceId],
      );
      const head = headRows[0];
      const seq = (head ? Number(head.seq) : 0) + 1;
      const prevHash = head?.hash ?? GENESIS_HASH;
      const createdAt = new Date();
      const hashable = {
        seq,
        workspaceId: input.workspaceId,
        actorMemberId: input.actorMemberId ?? null,
        actorDeviceId: input.actorDeviceId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        outcome: input.outcome,
        metadata: input.metadata ?? {},
        createdAt,
        prevHash,
      };
      const hash = computeEventHash(hashable);
      const { rows } = await client.query<{ id: string }>(
        `insert into audit_events
           (workspace_id, seq, actor_member_id, actor_device_id, action, target_type,
            target_id, outcome, metadata, prev_hash, hash, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
         returning id`,
        [
          hashable.workspaceId,
          seq,
          hashable.actorMemberId,
          hashable.actorDeviceId,
          hashable.action,
          hashable.targetType,
          hashable.targetId,
          hashable.outcome,
          JSON.stringify(hashable.metadata),
          prevHash,
          hash,
          createdAt,
        ],
      );
      await client.query("commit");
      return { id: rows[0]!.id, ...hashable, hash };
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async list(workspaceId: string): Promise<AuditEvent[]> {
    const { rows } = await this.pool.query<AuditRow>(
      `select id, workspace_id, seq, actor_member_id, actor_device_id, action, target_type,
              target_id, outcome, metadata, prev_hash, hash, created_at
         from audit_events where workspace_id = $1 order by seq asc`,
      [workspaceId],
    );
    return rows.map(toAudit);
  }
}
