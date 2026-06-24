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

// A fixed clock keeps records ordering-stable in tests; real time isn't important here.
const EPOCH = new Date("2026-01-01T00:00:00Z");

export class InMemoryWorkspaceRepo implements WorkspaceRepo {
  private readonly byId = new Map<string, Workspace>();

  async create(input: { name: string; kdfSalt: string }): Promise<Workspace> {
    const w: Workspace = { id: randomUUID(), createdAt: EPOCH, ...input };
    this.byId.set(w.id, w);
    return w;
  }
  async findById(id: string): Promise<Workspace | null> {
    return this.byId.get(id) ?? null;
  }
  async update(id: string, patch: { name?: string }): Promise<Workspace | null> {
    const w = this.byId.get(id);
    if (!w) return null;
    if (patch.name !== undefined) w.name = patch.name;
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
  async upsert(key: StoredWrappedKey): Promise<void> {
    this.byKey.set(this.k(key.workspaceId, key.deviceId), key);
  }
}
