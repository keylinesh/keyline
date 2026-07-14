/**
 * Email magic-link sign-in (#68) — dashboard re-entry without a terminal.
 *
 * Deliberately narrower than it sounds (ADR-0003 addendum):
 * - Only members with at least one ACTIVE device can request a link, and the
 *   minted 8h browser session is bound to that device — so member/device
 *   revocation kills magic sessions exactly like CLI-approved ones.
 * - Enrollment stays join-code-only; email is a re-entry factor, not a root
 *   for new access.
 * - The dashboard is metadata-only (ADR-0002): a compromised inbox never
 *   reaches secret values.
 * - Request responses never reveal whether an email exists.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { DeviceRepo } from "../auth/device-login.js";
import type { TokenService } from "../auth/tokens.js";
import type { AuditService } from "./audit.js";
import type { Member, MemberRepo } from "./members.js";
import type { WorkspaceRepo } from "./resources.js";
import { WEB_TOKEN_TTL_MS } from "./web-sessions.js";
import { magicLinkEmail, type EmailSender } from "../email/sender.js";
import type { Role } from "../auth/scope.js";

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

export function generateMagicToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashMagicToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface MagicLinkRecord {
  id: string;
  memberId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface MagicLinkRepo {
  create(input: { memberId: string; tokenHash: string; expiresAt: Date }): Promise<MagicLinkRecord>;
  findByTokenHash(tokenHash: string): Promise<MagicLinkRecord | null>;
  /** Atomic unused → used; false when already used (single-use guarantee). */
  markUsed(id: string, at: Date): Promise<boolean>;
}

export class InMemoryMagicLinkRepo implements MagicLinkRepo {
  private readonly byId = new Map<string, MagicLinkRecord>();

  async create(input: { memberId: string; tokenHash: string; expiresAt: Date }): Promise<MagicLinkRecord> {
    const rec: MagicLinkRecord = {
      id: `ml_${this.byId.size + 1}`,
      memberId: input.memberId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: null,
    };
    this.byId.set(rec.id, rec);
    return rec;
  }
  async findByTokenHash(tokenHash: string): Promise<MagicLinkRecord | null> {
    for (const rec of this.byId.values()) if (rec.tokenHash === tokenHash) return rec;
    return null;
  }
  async markUsed(id: string, at: Date): Promise<boolean> {
    const rec = this.byId.get(id);
    if (!rec || rec.usedAt) return false;
    rec.usedAt = at;
    return true;
  }
}

export class PgMagicLinkRepo implements MagicLinkRepo {
  constructor(private readonly pool: Pool) {}

  async create(input: { memberId: string; tokenHash: string; expiresAt: Date }): Promise<MagicLinkRecord> {
    const { rows } = await this.pool.query<{ id: string }>(
      `insert into magic_links (member_id, token_hash, expires_at)
       values ($1, $2, $3) returning id`,
      [input.memberId, input.tokenHash, input.expiresAt],
    );
    return { id: rows[0]!.id, memberId: input.memberId, tokenHash: input.tokenHash, expiresAt: input.expiresAt, usedAt: null };
  }
  async findByTokenHash(tokenHash: string): Promise<MagicLinkRecord | null> {
    const { rows } = await this.pool.query<{
      id: string; member_id: string; token_hash: string; expires_at: Date; used_at: Date | null;
    }>(`select id, member_id, token_hash, expires_at, used_at from magic_links where token_hash = $1`, [tokenHash]);
    const r = rows[0];
    return r ? { id: r.id, memberId: r.member_id, tokenHash: r.token_hash, expiresAt: r.expires_at, usedAt: r.used_at } : null;
  }
  async markUsed(id: string, at: Date): Promise<boolean> {
    const res = await this.pool.query(
      `update magic_links set used_at = $2 where id = $1 and used_at is null`,
      [id, at],
    );
    return (res.rowCount ?? 0) > 0;
  }
}

export interface MagicClaim {
  token: string;
  expiresAt: Date;
  workspaceId: string;
  memberId: string;
  role: Role;
}

export class MagicLinkService {
  constructor(
    private readonly links: MagicLinkRepo,
    private readonly members: MemberRepo,
    private readonly devices: DeviceRepo,
    private readonly workspaces: WorkspaceRepo,
    private readonly tokens: TokenService,
    private readonly email: EmailSender | null,
    private readonly audit: AuditService,
    private readonly appBaseUrl: string = "https://keyline.sh/app",
  ) {}

  /**
   * Request a link. ALWAYS resolves quietly — the response never says whether
   * the email exists, has a device, or was sent anything.
   */
  async start(email: string, now: Date = new Date()): Promise<void> {
    if (!this.email) return;
    const member = await this.eligibleMember(email);
    if (!member) return;

    const token = generateMagicToken();
    await this.links.create({
      memberId: member.id,
      tokenHash: hashMagicToken(token),
      expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MS),
    });
    const workspace = await this.workspaces.findById(member.workspaceId);
    const message = magicLinkEmail({
      workspaceName: workspace?.name ?? "your workspace",
      url: `${this.appBaseUrl}/#ml=${token}`,
    });
    await this.email.send({ to: member.email, ...message });
    await this.audit.record({
      workspaceId: member.workspaceId,
      actorMemberId: member.id,
      action: "web.magic.request",
      targetType: "member",
      targetId: member.id,
      outcome: "allowed",
    });
  }

  /** Redeem a link: one-time, 15-minute, bound to an active device. */
  async claim(token: string, now: Date = new Date()): Promise<MagicClaim | null> {
    const rec = await this.links.findByTokenHash(hashMagicToken(token));
    if (!rec || rec.usedAt || rec.expiresAt.getTime() <= now.getTime()) return null;
    const member = await this.members.findById(rec.memberId);
    if (!member) return null;
    const device = await this.activeDevice(member.id);
    if (!device) return null; // revoked since the link was sent: fail closed
    if (!(await this.links.markUsed(rec.id, now))) return null;

    const { token: session, expiresAt } = await this.tokens.issue({
      deviceId: device.id,
      memberId: member.id,
      scope: { workspaceId: member.workspaceId, role: member.role },
      ttlMs: WEB_TOKEN_TTL_MS,
      now,
    });
    await this.audit.record({
      workspaceId: member.workspaceId,
      actorMemberId: member.id,
      actorDeviceId: device.id,
      action: "web.magic.signin",
      targetType: "member",
      targetId: member.id,
      outcome: "allowed",
    });
    return {
      token: session,
      expiresAt,
      workspaceId: member.workspaceId,
      memberId: member.id,
      role: member.role,
    };
  }

  /** Newest membership for this email that has an active device. */
  private async eligibleMember(email: string): Promise<Member | null> {
    const matches = await this.members.findByEmailAnywhere(email.trim().toLowerCase());
    for (const member of matches) {
      if (await this.activeDevice(member.id)) return member;
    }
    return null;
  }

  private async activeDevice(memberId: string) {
    const devices = await this.devices.listByMember(memberId);
    return devices.find((d) => !d.revokedAt) ?? null;
  }
}
