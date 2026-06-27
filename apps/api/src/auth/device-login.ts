/**
 * Device login via proof-of-possession.
 *
 * A device proves it holds its private key without ever sending it:
 *   1. register() stores the device's public key under a member (first login).
 *   2. beginChallenge() seals a random 32-byte value to that public key using
 *      the M1 envelope sealed-box (only the device's private key can open it).
 *   3. completeLogin() checks the returned value and issues a scoped token.
 *
 * The server only ever handles the device's PUBLIC key here. See
 * docs/encryption-design.md §3-4.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { wrapWorkspaceKey, type WrappedKey } from "@keyline/crypto";
import type { Role, Scope } from "./scope.js";
import type { TokenService } from "./tokens.js";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface DeviceRecord {
  id: string;
  memberId: string;
  workspaceId: string;
  /** base64 SPKI DER (X25519). */
  publicKey: string;
  role: Role;
  revokedAt: Date | null;
}

export interface RegisterInput {
  memberId: string;
  workspaceId: string;
  publicKey: string;
  role: Role;
  name?: string;
}

export interface DeviceRepo {
  findById(id: string): Promise<DeviceRecord | null>;
  findByPublicKey(publicKey: string): Promise<DeviceRecord | null>;
  register(input: RegisterInput): Promise<DeviceRecord>;
  /** All devices belonging to a member (used by member revoke, #25). */
  listByMember(memberId: string): Promise<DeviceRecord[]>;
  /** Mark a device revoked (sets revokedAt). */
  revoke(deviceId: string, when: Date): Promise<void>;
}

export interface ChallengeRecord {
  id: string;
  deviceId: string;
  challenge: string; // base64
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface ChallengeRepo {
  create(rec: { deviceId: string; challenge: string; expiresAt: Date }): Promise<{ id: string }>;
  findById(id: string): Promise<ChallengeRecord | null>;
  consume(id: string, when: Date): Promise<void>;
}

export const CHALLENGE_TTL_MS = 2 * 60 * 1000; // 2 minutes

export class DeviceLoginService {
  constructor(
    private readonly devices: DeviceRepo,
    private readonly challenges: ChallengeRepo,
    private readonly tokens: TokenService,
  ) {}

  /** Register a device public key under a member. Idempotent on the public key. */
  async register(input: RegisterInput): Promise<DeviceRecord> {
    const existing = await this.devices.findByPublicKey(input.publicKey);
    if (existing) return existing;
    return this.devices.register(input);
  }

  /** Step 1: issue a sealed challenge the device must unseal with its private key. */
  async beginChallenge(
    deviceId: string,
    now: Date = new Date(),
  ): Promise<{ challengeId: string; sealed: WrappedKey }> {
    const device = await this.devices.findById(deviceId);
    if (!device || device.revokedAt) throw new AuthError("device not found or revoked");

    const challenge = randomBytes(32);
    const sealed = wrapWorkspaceKey(challenge, device.publicKey);
    const { id } = await this.challenges.create({
      deviceId,
      challenge: challenge.toString("base64"),
      expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
    });
    return { challengeId: id, sealed };
  }

  /** Step 2: verify the unsealed answer and issue a scoped, short-lived token. */
  async completeLogin(
    input: { challengeId: string; answer: string; environmentIds?: string[] },
    now: Date = new Date(),
  ): Promise<{ token: string; expiresAt: Date }> {
    const ch = await this.challenges.findById(input.challengeId);
    if (!ch || ch.consumedAt) throw new AuthError("invalid or already-used challenge");
    if (ch.expiresAt.getTime() <= now.getTime()) throw new AuthError("challenge expired");

    const expected = Buffer.from(ch.challenge, "base64");
    const got = Buffer.from(input.answer, "base64");
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
      throw new AuthError("challenge response did not match");
    }
    // One-time: consume before issuing so a replayed answer cannot mint a second token.
    await this.challenges.consume(ch.id, now);

    const device = await this.devices.findById(ch.deviceId);
    if (!device || device.revokedAt) throw new AuthError("device not found or revoked");

    const scope: Scope = {
      workspaceId: device.workspaceId,
      role: device.role,
      environmentIds: input.environmentIds,
    };
    return this.tokens.issue({ deviceId: device.id, memberId: device.memberId, scope, now });
  }
}
