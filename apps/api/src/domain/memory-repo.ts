/**
 * In-memory resource repositories for tests and local dev (no database).
 */

import { randomUUID } from "node:crypto";
import type {
  Environment,
  EnvironmentRepo,
  Project,
  ProjectRepo,
  Workspace,
  WorkspacePlan,
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
  type AuditRepo,
  computeEventHash,
  GENESIS_HASH,
} from "./audit.js";
import type { Role } from "../auth/scope.js";
import type { WebSessionGrant, WebSessionRecord, WebSessionRepo } from "./web-sessions.js";

// A fixed clock keeps records ordering-stable in tests; real time isn't important here.
const EPOCH = new Date("2026-01-01T00:00:00Z");

export class InMemoryWorkspaceRepo implements WorkspaceRepo {
  private readonly byId = new Map<string, Workspace>();

  async create(input: { name: string; kdfSalt: string }): Promise<Workspace> {
    const w: Workspace = { id: randomUUID(), plan: "solo", createdAt: EPOCH, ...input };
    this.byId.set(w.id, w);
    return w;
  }
  async findById(id: string): Promise<Workspace | null> {
    return this.byId.get(id) ?? null;
  }
  async update(id: string, patch: { name?: string; plan?: WorkspacePlan }): Promise<Workspace | null> {
    const w = this.byId.get(id);
    if (!w) return null;
    if (patch.name !== undefined) w.name = patch.name;
    if (patch.plan !== undefined) w.plan = patch.plan;
    return w;
  }
  async delete(id: string): Promise<boolean> {
    return this.byId.delete(id);
  }
}

export class InMemoryProjectRepo implements ProjectRepo {
  private readonly byId = new Map<string, Project>();

  async create(input: { workspaceId: string; name: string; slug: string }): Promise<Project> {
    const p: Project = { id: randomUUID(), createdAt: EPOCH, ...input };
    this.byId.set(p.id, p);
    return p;
  }
  async findById(id: string): Promise<Project | null> {
    return this.byId.get(id) ?? null;
  }
  async listByWorkspace(workspaceId: string): Promise<Project[]> {
    return [...this.byId.values()].filter((p) => p.workspaceId === workspaceId);
  }
  async findBySlug(workspaceId: string, slug: string): Promise<Project | null> {
    for (const p of this.byId.values()) {
      if (p.workspaceId === workspaceId && p.slug === slug) return p;
    }
    return null;
  }
  async update(id: string, patch: { name?: string; slug?: string }): Promise<Project | null> {
    const p = this.byId.get(id);
    if (!p) return null;
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.slug !== undefined) p.slug = patch.slug;
    return p;
  }
  async delete(id: string): Promise<boolean> {
    return this.byId.delete(id);
  }
}

export class InMemoryEnvironmentRepo implements EnvironmentRepo {
  private readonly byId = new Map<string, Environment>();

  async create(input: { projectId: string; name: string }): Promise<Environment> {
    const e: Environment = { id: randomUUID(), createdAt: EPOCH, ...input };
    this.byId.set(e.id, e);
    return e;
  }
  async findById(id: string): Promise<Environment | null> {
    return this.byId.get(id) ?? null;
  }
  async listByProject(projectId: string): Promise<Environment[]> {
    return [...this.byId.values()].filter((e) => e.projectId === projectId);
  }
  async findByName(projectId: string, name: string): Promise<Environment | null> {
    for (const e of this.byId.values()) {
      if (e.projectId === projectId && e.name === name) return e;
    }
    return null;
  }
  async update(id: string, patch: { name?: string }): Promise<Environment | null> {
    const e = this.byId.get(id);
    if (!e) return null;
    if (patch.name !== undefined) e.name = patch.name;
    return e;
  }
  async delete(id: string): Promise<boolean> {
    return this.byId.delete(id);
  }
}

export class InMemoryBundleRepo implements BundleRepo {
  private readonly byEnv = new Map<string, StoredBundle[]>();

  async getLatest(environmentId: string): Promise<StoredBundle | null> {
    const versions = this.byEnv.get(environmentId);
    return versions && versions.length > 0 ? versions[versions.length - 1]! : null;
  }

  async append(input: AppendBundleInput): Promise<StoredBundle> {
    const versions = this.byEnv.get(input.environmentId) ?? [];
    const current = versions.length > 0 ? versions[versions.length - 1]!.version : 0;
    if (input.baseVersion !== undefined && input.baseVersion !== current) {
      throw new VersionConflictError(current);
    }
    const bundle: StoredBundle = {
      id: randomUUID(),
      environmentId: input.environmentId,
      version: current + 1,
      formatVersion: input.formatVersion,
      nonce: input.nonce,
      ciphertext: input.ciphertext,
      tag: input.tag,
      createdByDeviceId: input.createdByDeviceId,
      createdAt: EPOCH,
    };
    versions.push(bundle);
    this.byEnv.set(input.environmentId, versions);
    return bundle;
  }
}

export class InMemoryWrappedKeyRepo implements WrappedKeyRepo {
  private readonly byKey = new Map<string, StoredWrappedKey>();
  private k(workspaceId: string, deviceId: string) {
    return `${workspaceId}:${deviceId}`;
  }
  async findForDevice(workspaceId: string, deviceId: string): Promise<StoredWrappedKey | null> {
    return this.byKey.get(this.k(workspaceId, deviceId)) ?? null;
  }
  async existsForWorkspace(workspaceId: string): Promise<boolean> {
    for (const key of this.byKey.values()) {
      if (key.workspaceId === workspaceId) return true;
    }
    return false;
  }
  async upsert(key: StoredWrappedKey): Promise<void> {
    this.byKey.set(this.k(key.workspaceId, key.deviceId), key);
  }
  async deleteForDevice(workspaceId: string, deviceId: string): Promise<boolean> {
    return this.byKey.delete(this.k(workspaceId, deviceId));
  }
}

export class InMemoryMemberRepo implements MemberRepo {
  private readonly byId = new Map<string, Member>();

  async create(input: {
    workspaceId: string;
    email: string;
    role: Role;
    displayName?: string;
  }): Promise<Member> {
    const m: Member = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      email: input.email,
      displayName: input.displayName ?? null,
      role: input.role,
      createdAt: EPOCH,
    };
    this.byId.set(m.id, m);
    return m;
  }
  async findById(id: string): Promise<Member | null> {
    return this.byId.get(id) ?? null;
  }
  async findByEmail(workspaceId: string, email: string): Promise<Member | null> {
    for (const m of this.byId.values()) {
      if (m.workspaceId === workspaceId && m.email === email) return m;
    }
    return null;
  }
  async listByWorkspace(workspaceId: string): Promise<Member[]> {
    return [...this.byId.values()].filter((m) => m.workspaceId === workspaceId);
  }
  async updateDisplayName(id: string, displayName: string | null): Promise<Member | null> {
    const m = this.byId.get(id);
    if (!m) return null;
    m.displayName = displayName;
    return m;
  }
  async delete(id: string): Promise<boolean> {
    return this.byId.delete(id);
  }
}

export class InMemoryEnvironmentAccessRepo implements EnvironmentAccessRepo {
  private readonly byKey = new Map<string, EnvAccess>();
  private k(environmentId: string, memberId: string) {
    return `${environmentId}:${memberId}`;
  }
  async grant(input: { environmentId: string; memberId: string; role: EnvRole }): Promise<EnvAccess> {
    const key = this.k(input.environmentId, input.memberId);
    const existing = this.byKey.get(key);
    const rec: EnvAccess = existing
      ? { ...existing, role: input.role }
      : { id: randomUUID(), createdAt: EPOCH, ...input };
    this.byKey.set(key, rec);
    return rec;
  }
  async get(memberId: string, environmentId: string): Promise<EnvAccess | null> {
    return this.byKey.get(this.k(environmentId, memberId)) ?? null;
  }
  async listByEnvironment(environmentId: string): Promise<EnvAccess[]> {
    return [...this.byKey.values()].filter((a) => a.environmentId === environmentId);
  }
  async revoke(environmentId: string, memberId: string): Promise<boolean> {
    return this.byKey.delete(this.k(environmentId, memberId));
  }
}

export class InMemoryAuditRepo implements AuditRepo {
  private readonly byWs = new Map<string, AuditEvent[]>();

  async append(input: AppendAuditInput): Promise<AuditEvent> {
    const events = this.byWs.get(input.workspaceId) ?? [];
    const head = events[events.length - 1];
    const seq = (head?.seq ?? 0) + 1;
    const prevHash = head?.hash ?? GENESIS_HASH;
    const createdAt = new Date(EPOCH.getTime() + seq * 1000);
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
    const event: AuditEvent = { id: randomUUID(), ...hashable, hash: computeEventHash(hashable) };
    events.push(event);
    this.byWs.set(input.workspaceId, events);
    return event;
  }

  async list(workspaceId: string): Promise<AuditEvent[]> {
    return [...(this.byWs.get(workspaceId) ?? [])];
  }

  async heads(): Promise<Array<{ workspaceId: string; seq: number; hash: string }>> {
    const out: Array<{ workspaceId: string; seq: number; hash: string }> = [];
    for (const [workspaceId, events] of this.byWs) {
      const head = events[events.length - 1];
      if (head) out.push({ workspaceId, seq: head.seq, hash: head.hash });
    }
    return out;
  }
}

export class InMemoryWebSessionRepo implements WebSessionRepo {
  private readonly byId = new Map<string, WebSessionRecord>();

  async create(input: { codeHash: string; expiresAt: Date }): Promise<WebSessionRecord> {
    const record: WebSessionRecord = {
      id: randomUUID(),
      codeHash: input.codeHash,
      status: "pending",
      memberId: null,
      deviceId: null,
      workspaceId: null,
      role: null,
      createdAt: EPOCH,
      expiresAt: input.expiresAt,
      approvedAt: null,
    };
    this.byId.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<WebSessionRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async findByCodeHash(codeHash: string): Promise<WebSessionRecord | null> {
    for (const s of this.byId.values()) if (s.codeHash === codeHash) return s;
    return null;
  }

  async approve(id: string, grant: WebSessionGrant, when: Date): Promise<boolean> {
    const s = this.byId.get(id);
    if (!s || s.status !== "pending") return false;
    Object.assign(s, { ...grant, status: "approved", approvedAt: when });
    return true;
  }

  async claim(id: string): Promise<WebSessionRecord | null> {
    const s = this.byId.get(id);
    if (!s || s.status !== "approved") return null;
    s.status = "claimed";
    return { ...s, status: "approved" };
  }
}
