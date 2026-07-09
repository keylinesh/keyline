/**
 * CLI-approved browser sessions (M4 #39, ADR-0003).
 *
 * Flow: the dashboard POSTs start → gets a session id + one-time code and
 * shows the code. The user runs `keyline web <code>`; the authenticated CLI
 * approves, binding member/device/workspace/role to the session. The browser
 * polls claim; on the first poll after approval the access token is minted
 * (TokenService) and the session flips to `claimed` — the token is released
 * exactly once and never stored.
 *
 * Codes are stored hashed. Pending sessions are short-lived; the issued web
 * token is bound to the APPROVING device, so revoking the member or device
 * kills web sessions along with everything else.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Role } from "../auth/scope.js";
import type { TokenService } from "../auth/tokens.js";

export const WEB_SESSION_TTL_MS = 10 * 60 * 1000; // pending code lifetime
export const WEB_TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // browser session lifetime

/** Unambiguous alphabet (no 0/O/1/I/L/U) for codes humans retype. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

export function generateSessionCode(): string {
  const bytes = randomBytes(8);
  let raw = "";
  for (let i = 0; i < 8; i++) raw += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** Uppercase and drop separators, so `lzq4 7nhk` matches `LZQ4-7NHK`. */
export function normalizeSessionCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashSessionCode(code: string): string {
  return createHash("sha256").update(normalizeSessionCode(code)).digest("hex");
}

export type WebSessionStatus = "pending" | "approved" | "claimed";

export interface WebSessionRecord {
  id: string;
  codeHash: string;
  status: WebSessionStatus;
  memberId: string | null;
  deviceId: string | null;
  workspaceId: string | null;
  role: Role | null;
  createdAt: Date;
  expiresAt: Date;
  approvedAt: Date | null;
}

export interface WebSessionGrant {
  memberId: string;
  deviceId: string;
  workspaceId: string;
  role: Role;
}

export interface WebSessionRepo {
  create(input: { codeHash: string; expiresAt: Date }): Promise<WebSessionRecord>;
  findById(id: string): Promise<WebSessionRecord | null>;
  findByCodeHash(codeHash: string): Promise<WebSessionRecord | null>;
  /** pending → approved with the grant; false if not pending. */
  approve(id: string, grant: WebSessionGrant, when: Date): Promise<boolean>;
  /** Atomic approved → claimed; returns the approved record only to the winner. */
  claim(id: string): Promise<WebSessionRecord | null>;
}

export type ClaimResult =
  | { status: "pending" | "expired" | "consumed" }
  | { status: "ready"; token: string; expiresAt: Date; workspaceId: string };

export class WebSessionService {
  constructor(
    private readonly repo: WebSessionRepo,
    private readonly tokens: TokenService,
  ) {}

  async start(now: Date = new Date()): Promise<{ sessionId: string; code: string; expiresAt: Date }> {
    const code = generateSessionCode();
    const record = await this.repo.create({
      codeHash: hashSessionCode(code),
      expiresAt: new Date(now.getTime() + WEB_SESSION_TTL_MS),
    });
    return { sessionId: record.id, code, expiresAt: record.expiresAt };
  }

  /** Approve a pending session by its code. */
  async approve(
    code: string,
    grant: WebSessionGrant,
    now: Date = new Date(),
  ): Promise<"ok" | "not_found" | "expired"> {
    const session = await this.repo.findByCodeHash(hashSessionCode(code));
    if (!session || session.status !== "pending") return "not_found";
    if (session.expiresAt.getTime() <= now.getTime()) return "expired";
    const approved = await this.repo.approve(session.id, grant, now);
    return approved ? "ok" : "not_found";
  }

  /** Poll a session; mints and releases the token exactly once. */
  async claim(sessionId: string, now: Date = new Date()): Promise<ClaimResult | null> {
    const session = await this.repo.findById(sessionId);
    if (!session) return null;
    if (session.status === "claimed") return { status: "consumed" };
    if (session.status === "pending") {
      return session.expiresAt.getTime() <= now.getTime()
        ? { status: "expired" }
        : { status: "pending" };
    }
    const won = await this.repo.claim(session.id);
    if (!won || !won.memberId || !won.deviceId || !won.workspaceId || !won.role) {
      return { status: "consumed" };
    }
    const { token, expiresAt } = await this.tokens.issue({
      deviceId: won.deviceId,
      memberId: won.memberId,
      scope: { workspaceId: won.workspaceId, role: won.role },
      ttlMs: WEB_TOKEN_TTL_MS,
      now,
    });
    return { status: "ready", token, expiresAt, workspaceId: won.workspaceId };
  }
}
