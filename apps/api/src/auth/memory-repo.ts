/**
 * In-memory repositories for tests and local dev (no database).
 * The pg-backed equivalents live in pg-repo.ts.
 */

import { randomUUID } from "node:crypto";
import type { StoredToken, TokenRepo } from "./tokens.js";
import type {
  ChallengeRecord,
  ChallengeRepo,
  DeviceRecord,
  DeviceRepo,
  RegisterInput,
} from "./device-login.js";

export class InMemoryDeviceRepo implements DeviceRepo {
  private readonly byId = new Map<string, DeviceRecord>();

  async findById(id: string): Promise<DeviceRecord | null> {
    return this.byId.get(id) ?? null;
  }
  async findByPublicKey(publicKey: string): Promise<DeviceRecord | null> {
    for (const d of this.byId.values()) if (d.publicKey === publicKey) return d;
    return null;
  }
  async register(input: RegisterInput): Promise<DeviceRecord> {
    const record: DeviceRecord = {
      id: randomUUID(),
      memberId: input.memberId,
      workspaceId: input.workspaceId,
      publicKey: input.publicKey,
      role: input.role,
      revokedAt: null,
    };
    this.byId.set(record.id, record);
    return record;
  }
  /** test helper */
  async revoke(id: string, when: Date): Promise<void> {
    const d = this.byId.get(id);
    if (d) d.revokedAt = when;
  }
}

export class InMemoryChallengeRepo implements ChallengeRepo {
  private readonly byId = new Map<string, ChallengeRecord>();

  async create(rec: { deviceId: string; challenge: string; expiresAt: Date }): Promise<{ id: string }> {
    const id = randomUUID();
    this.byId.set(id, { id, consumedAt: null, ...rec });
    return { id };
  }
  async findById(id: string): Promise<ChallengeRecord | null> {
    return this.byId.get(id) ?? null;
  }
  async consume(id: string, when: Date): Promise<void> {
    const c = this.byId.get(id);
    if (c) c.consumedAt = when;
  }
}

export class InMemoryTokenRepo implements TokenRepo {
  private readonly byHash = new Map<string, StoredToken>();

  async insert(token: StoredToken): Promise<void> {
    this.byHash.set(token.tokenHash, token);
  }
  async findByHash(hash: string): Promise<StoredToken | null> {
    return this.byHash.get(hash) ?? null;
  }
  async revokeByHash(hash: string, when: Date): Promise<void> {
    const t = this.byHash.get(hash);
    if (t) t.revokedAt = when;
  }
  async revokeByDevice(deviceId: string, when: Date): Promise<number> {
    let n = 0;
    for (const t of this.byHash.values()) {
      if (t.deviceId === deviceId && !t.revokedAt) {
        t.revokedAt = when;
        n++;
      }
    }
    return n;
  }
}
