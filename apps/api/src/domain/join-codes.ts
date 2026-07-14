/**
 * Teammate join codes (#66) — how an invited member's device gets enrolled.
 *
 * Inviting mints a one-time code (hashed at rest, 7-day TTL, one active code
 * per member — regenerating replaces it). The teammate redeems it with their
 * device public key: we register the device under that membership and burn
 * the code. This replaces the open POST /v1/devices seam (#64): enrollment
 * now always goes through an admin-issued code.
 */

import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { DeviceLoginService } from "../auth/device-login.js";
import type { AuditService } from "./audit.js";
import type { MemberRepo } from "./members.js";
import type { WorkspaceRepo } from "./resources.js";
import { hashSessionCode } from "./web-sessions.js";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
const CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** XXXX-XXXX-XXXX: 12 chars of a 31-letter alphabet (~10^17), 7-day TTL. */
export function generateJoinCode(): string {
  const bytes = randomBytes(12);
  let raw = "";
  for (let i = 0; i < 12; i++) raw += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

export interface JoinCodeRecord {
  memberId: string;
  codeHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface JoinCodeRepo {
  /** One active code per member: insert or replace, resetting used_at. */
  upsertForMember(input: { memberId: string; codeHash: string; expiresAt: Date }): Promise<void>;
  findByCodeHash(codeHash: string): Promise<JoinCodeRecord | null>;
  markUsed(memberId: string, at: Date): Promise<void>;
}

export class InMemoryJoinCodeRepo implements JoinCodeRepo {
  private readonly byMember = new Map<string, JoinCodeRecord>();

  async upsertForMember(input: { memberId: string; codeHash: string; expiresAt: Date }): Promise<void> {
    this.byMember.set(input.memberId, { ...input, usedAt: null });
  }
  async findByCodeHash(codeHash: string): Promise<JoinCodeRecord | null> {
    for (const rec of this.byMember.values()) if (rec.codeHash === codeHash) return rec;
    return null;
  }
  async markUsed(memberId: string, at: Date): Promise<void> {
    const rec = this.byMember.get(memberId);
    if (rec) rec.usedAt = at;
  }
}

export class PgJoinCodeRepo implements JoinCodeRepo {
  constructor(private readonly pool: Pool) {}

  async upsertForMember(input: { memberId: string; codeHash: string; expiresAt: Date }): Promise<void> {
    await this.pool.query(
      `insert into member_join_codes (member_id, code_hash, expires_at)
       values ($1, $2, $3)
       on conflict (member_id) do update set
         code_hash = excluded.code_hash, expires_at = excluded.expires_at,
         created_at = now(), used_at = null`,
      [input.memberId, input.codeHash, input.expiresAt],
    );
  }
  async findByCodeHash(codeHash: string): Promise<JoinCodeRecord | null> {
    const { rows } = await this.pool.query<{
      member_id: string; code_hash: string; expires_at: Date; used_at: Date | null;
    }>(`select member_id, code_hash, expires_at, used_at from member_join_codes where code_hash = $1`, [codeHash]);
    const r = rows[0];
    return r ? { memberId: r.member_id, codeHash: r.code_hash, expiresAt: r.expires_at, usedAt: r.used_at } : null;
  }
  async markUsed(memberId: string, at: Date): Promise<void> {
    await this.pool.query(`update member_join_codes set used_at = $2 where member_id = $1`, [memberId, at]);
  }
}

export class JoinError extends Error {}

export interface JoinResult {
  workspaceId: string;
  workspaceName: string;
  memberId: string;
  deviceId: string;
  email: string;
  role: string;
}

export class JoinService {
  constructor(
    private readonly codes: JoinCodeRepo,
    private readonly members: MemberRepo,
    private readonly workspaces: WorkspaceRepo,
    private readonly login: DeviceLoginService,
    private readonly audit: AuditService,
  ) {}

  /** Mint (or replace) the member's join code. The plaintext is returned once. */
  async issue(memberId: string, now: Date = new Date()): Promise<{ code: string; expiresAt: Date }> {
    const code = generateJoinCode();
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
    await this.codes.upsertForMember({ memberId, codeHash: hashSessionCode(code), expiresAt });
    return { code, expiresAt };
  }

  /** Redeem a code: register the device under the invited membership. */
  async redeem(
    input: { code: string; devicePublicKey: string; deviceName?: string },
    now: Date = new Date(),
  ): Promise<JoinResult> {
    const rec = await this.codes.findByCodeHash(hashSessionCode(input.code));
    if (!rec || rec.usedAt || rec.expiresAt.getTime() <= now.getTime()) {
      throw new JoinError("that join code is unknown, used, or expired");
    }
    const member = await this.members.findById(rec.memberId);
    if (!member) throw new JoinError("that join code is unknown, used, or expired");
    const workspace = await this.workspaces.findById(member.workspaceId);
    if (!workspace) throw new JoinError("that join code is unknown, used, or expired");

    const device = await this.login.register({
      memberId: member.id,
      workspaceId: member.workspaceId,
      publicKey: input.devicePublicKey,
      role: member.role,
      name: input.deviceName,
    });
    await this.codes.markUsed(member.id, now);
    await this.audit.record({
      workspaceId: member.workspaceId,
      actorMemberId: member.id,
      actorDeviceId: device.id,
      action: "member.join",
      targetType: "member",
      targetId: member.id,
      outcome: "allowed",
      metadata: { email: member.email },
    });
    return {
      workspaceId: member.workspaceId,
      workspaceName: workspace.name,
      memberId: member.id,
      deviceId: device.id,
      email: member.email,
      role: member.role,
    };
  }
}
