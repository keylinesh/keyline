/**
 * Member revocation (#25) — cut a member's access immediately.
 *
 * Revoking drops everything that lets the member act or decrypt, in one call:
 *   - revoke all their access tokens (they can no longer call the API), and
 *   - delete each device's wrapped workspace key + mark the device revoked
 *     (they can no longer unwrap the workspace key, so new ciphertext is opaque).
 *
 * The member and the existing ciphertext are left intact; this only removes
 * access. Stored bundles stay readable to remaining members.
 */

import type { DeviceRepo } from "../auth/device-login.js";
import type { TokenService } from "../auth/tokens.js";
import type { WrappedKeyRepo } from "../domain/bundles.js";

export interface RevokeResult {
  tokensRevoked: number;
  devicesRevoked: number;
  wrappedKeysDeleted: number;
}

export class RevokeService {
  constructor(
    private readonly devices: DeviceRepo,
    private readonly wrappedKeys: WrappedKeyRepo,
    private readonly tokens: TokenService,
  ) {}

  async revokeMember(
    workspaceId: string,
    memberId: string,
    now: Date = new Date(),
  ): Promise<RevokeResult> {
    const tokensRevoked = await this.tokens.revokeMember(memberId, now);
    const devices = await this.devices.listByMember(memberId);
    let wrappedKeysDeleted = 0;
    for (const device of devices) {
      if (await this.wrappedKeys.deleteForDevice(workspaceId, device.id)) wrappedKeysDeleted++;
      await this.devices.revoke(device.id, now);
    }
    return { tokensRevoked, devicesRevoked: devices.length, wrappedKeysDeleted };
  }
}
