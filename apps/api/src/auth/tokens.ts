/**
 * Scoped access tokens.
 *
 * Tokens are opaque random strings. Only their SHA-256 hash is stored, so a
 * database leak exposes no usable token. Each token is short-lived, bound to a
 * device + member + workspace scope, and revocable (per token or per device).
 */

import { createHash, randomBytes } from "node:crypto";
import type { Role, Scope } from "./scope.js";

export interface StoredToken {
  tokenHash: string;
  deviceId: string;
  memberId: string;
  workspaceId: string;
  role: Role;
  /** null = not restricted to specific environments. */
  environmentIds: string[] | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** Persistence for tokens. A pg-backed implementation lives in pg-repo.ts. */
export interface TokenRepo {
  insert(token: StoredToken): Promise<void>;
  findByHash(hash: string): Promise<StoredToken | null>;
  revokeByHash(hash: string, when: Date): Promise<void>;
  /** Revoke every active token for a device; returns how many were revoked. */
  revokeByDevice(deviceId: string, when: Date): Promise<number>;
}

/** The authenticated caller behind a valid token. */
export interface Principal {
  deviceId: string;
  memberId: string;
  scope: Scope;
}

const TOKEN_PREFIX = "klk_";
export const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

/** SHA-256 hex of a token. Stored instead of the token itself. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssueOptions {
  deviceId: string;
  memberId: string;
  scope: Scope;
  ttlMs?: number;
  now?: Date;
}

export class TokenService {
  constructor(private readonly repo: TokenRepo) {}

  /** Mint a new token; returns the plaintext (shown once) and its expiry. */
  async issue(opts: IssueOptions): Promise<{ token: string; expiresAt: Date }> {
    const now = opts.now ?? new Date();
    const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + (opts.ttlMs ?? DEFAULT_TTL_MS));
    await this.repo.insert({
      tokenHash: hashToken(token),
      deviceId: opts.deviceId,
      memberId: opts.memberId,
      workspaceId: opts.scope.workspaceId,
      role: opts.scope.role,
      environmentIds: opts.scope.environmentIds ?? null,
      expiresAt,
      revokedAt: null,
    });
    return { token, expiresAt };
  }

  /** Resolve a token to its principal, or null if missing/expired/revoked. */
  async verify(token: string, now: Date = new Date()): Promise<Principal | null> {
    const stored = await this.repo.findByHash(hashToken(token));
    if (!stored) return null;
    if (stored.revokedAt) return null;
    if (stored.expiresAt.getTime() <= now.getTime()) return null;
    return {
      deviceId: stored.deviceId,
      memberId: stored.memberId,
      scope: {
        workspaceId: stored.workspaceId,
        role: stored.role,
        environmentIds: stored.environmentIds ?? undefined,
      },
    };
  }

  /** Revoke a single token. */
  async revoke(token: string, now: Date = new Date()): Promise<void> {
    await this.repo.revokeByHash(hashToken(token), now);
  }

  /** Revoke all of a device's tokens (used by revoke/rotate in #25). */
  async revokeDevice(deviceId: string, now: Date = new Date()): Promise<number> {
    return this.repo.revokeByDevice(deviceId, now);
  }
}
