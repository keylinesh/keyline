/**
 * Postgres-backed repositories (schema from migrations 0001/0002).
 *
 * Exercised once a database is provisioned (#27); until then the in-memory
 * repos cover the service-layer tests and these are kept honest by typecheck.
 */

import type { Pool } from "pg";
import type { Role } from "./scope.js";
import type { StoredToken, TokenRepo } from "./tokens.js";
import type {
  ChallengeRecord,
  ChallengeRepo,
  DeviceRecord,
  DeviceRepo,
  RegisterInput,
} from "./device-login.js";

interface DeviceRow {
  id: string;
  member_id: string;
  workspace_id: string;
  public_key: string;
  role: Role;
  revoked_at: Date | null;
}

function toDeviceRecord(r: DeviceRow): DeviceRecord {
  return {
    id: r.id,
    memberId: r.member_id,
    workspaceId: r.workspace_id,
    publicKey: r.public_key,
    role: r.role,
    revokedAt: r.revoked_at,
  };
}

export class PgDeviceRepo implements DeviceRepo {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<DeviceRecord | null> {
    const { rows } = await this.pool.query<DeviceRow>(
      `select d.id, d.member_id, m.workspace_id, d.public_key, m.role, d.revoked_at
         from devices d join members m on m.id = d.member_id
        where d.id = $1`,
      [id],
    );
    return rows[0] ? toDeviceRecord(rows[0]) : null;
  }

  async findByPublicKey(publicKey: string): Promise<DeviceRecord | null> {
    const { rows } = await this.pool.query<DeviceRow>(
      `select d.id, d.member_id, m.workspace_id, d.public_key, m.role, d.revoked_at
         from devices d join members m on m.id = d.member_id
        where d.public_key = $1`,
      [publicKey],
    );
    return rows[0] ? toDeviceRecord(rows[0]) : null;
  }

  async register(input: RegisterInput): Promise<DeviceRecord> {
    const { rows } = await this.pool.query<{ id: string; revoked_at: Date | null }>(
      `insert into devices (member_id, public_key, name)
       values ($1, $2, $3)
       returning id, revoked_at`,
      [input.memberId, input.publicKey, input.name ?? null],
    );
    const row = rows[0];
    if (!row) throw new Error("device insert returned no row");
    return {
      id: row.id,
      memberId: input.memberId,
      workspaceId: input.workspaceId,
      publicKey: input.publicKey,
      role: input.role,
      revokedAt: row.revoked_at,
    };
  }
}

export class PgChallengeRepo implements ChallengeRepo {
  constructor(private readonly pool: Pool) {}

  async create(rec: { deviceId: string; challenge: string; expiresAt: Date }): Promise<{ id: string }> {
    const { rows } = await this.pool.query<{ id: string }>(
      `insert into device_challenges (device_id, challenge, expires_at)
       values ($1, $2, $3) returning id`,
      [rec.deviceId, rec.challenge, rec.expiresAt],
    );
    const row = rows[0];
    if (!row) throw new Error("challenge insert returned no row");
    return { id: row.id };
  }

  async findById(id: string): Promise<ChallengeRecord | null> {
    const { rows } = await this.pool.query<{
      id: string;
      device_id: string;
      challenge: string;
      expires_at: Date;
      consumed_at: Date | null;
    }>(
      `select id, device_id, challenge, expires_at, consumed_at
         from device_challenges where id = $1`,
      [id],
    );
    const r = rows[0];
    return r
      ? {
          id: r.id,
          deviceId: r.device_id,
          challenge: r.challenge,
          expiresAt: r.expires_at,
          consumedAt: r.consumed_at,
        }
      : null;
  }

  async consume(id: string, when: Date): Promise<void> {
    await this.pool.query(
      `update device_challenges set consumed_at = $2 where id = $1`,
      [id, when],
    );
  }
}

export class PgTokenRepo implements TokenRepo {
  constructor(private readonly pool: Pool) {}

  async insert(token: StoredToken): Promise<void> {
    await this.pool.query(
      `insert into access_tokens
         (token_hash, device_id, member_id, workspace_id, role, environment_ids, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        token.tokenHash,
        token.deviceId,
        token.memberId,
        token.workspaceId,
        token.role,
        token.environmentIds,
        token.expiresAt,
      ],
    );
  }

  async findByHash(hash: string): Promise<StoredToken | null> {
    const { rows } = await this.pool.query<{
      token_hash: string;
      device_id: string;
      member_id: string;
      workspace_id: string;
      role: Role;
      environment_ids: string[] | null;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `select token_hash, device_id, member_id, workspace_id, role,
              environment_ids, expires_at, revoked_at
         from access_tokens where token_hash = $1`,
      [hash],
    );
    const r = rows[0];
    return r
      ? {
          tokenHash: r.token_hash,
          deviceId: r.device_id,
          memberId: r.member_id,
          workspaceId: r.workspace_id,
          role: r.role,
          environmentIds: r.environment_ids,
          expiresAt: r.expires_at,
          revokedAt: r.revoked_at,
        }
      : null;
  }

  async revokeByHash(hash: string, when: Date): Promise<void> {
    await this.pool.query(
      `update access_tokens set revoked_at = $2 where token_hash = $1 and revoked_at is null`,
      [hash, when],
    );
  }

  async revokeByDevice(deviceId: string, when: Date): Promise<number> {
    const res = await this.pool.query(
      `update access_tokens set revoked_at = $2 where device_id = $1 and revoked_at is null`,
      [deviceId, when],
    );
    return res.rowCount ?? 0;
  }
}
