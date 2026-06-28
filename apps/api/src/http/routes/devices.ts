/**
 * Device key management (#60) — issue a wrapped workspace key to a device.
 *
 *   PUT /v1/devices/:id/wrapped-key
 *
 * The client wraps the workspace key to the target device's public key (envelope
 * encryption, client-side) and uploads the WrappedKey; the server stores it so
 * that device can unwrap the workspace key on pull. This is the inverse of
 * revoke (#25). The server never sees the workspace key — only the wrapped blob.
 *
 * Authorization: the caller must be in the device's workspace, and either a
 * workspace admin/owner (issuing to anyone) or the device's own member.
 */

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { DeviceRepo } from "../../auth/device-login.js";
import type { AuditService } from "../../domain/audit.js";
import type { WrappedKeyRepo } from "../../domain/bundles.js";
import { type AppEnv, requireWorkspace } from "../authz.js";
import { forbidden, notFound } from "../errors.js";
import { parseBody } from "../validate.js";

export interface DeviceRouteDeps {
  devices: DeviceRepo;
  wrappedKeys: WrappedKeyRepo;
  audit: AuditService;
}

const b64 = z.string().min(1);
const wrappedKeySchema = z.object({
  wrappedKey: z.object({
    v: z.number().int().positive(),
    eph: b64,
    nonce: b64,
    ct: b64,
    tag: b64,
  }),
});

export function registerDeviceRoutes(
  app: Hono<AppEnv>,
  deps: DeviceRouteDeps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  app.put("/v1/devices/:id/wrapped-key", auth, async (c) => {
    const device = await deps.devices.findById(c.req.param("id"));
    if (!device) throw notFound("device not found");

    const principal = c.get("principal");
    requireWorkspace(principal, device.workspaceId);
    const isAdmin = principal.scope.role === "admin" || principal.scope.role === "owner";
    if (!isAdmin && device.memberId !== principal.memberId) {
      throw forbidden("requires admin to issue a key to another member's device");
    }

    const { wrappedKey } = await parseBody(c, wrappedKeySchema);
    await deps.wrappedKeys.upsert({
      workspaceId: device.workspaceId,
      deviceId: device.id,
      formatVersion: wrappedKey.v,
      eph: wrappedKey.eph,
      nonce: wrappedKey.nonce,
      ct: wrappedKey.ct,
      tag: wrappedKey.tag,
    });

    await deps.audit.record({
      workspaceId: device.workspaceId,
      actorMemberId: principal.memberId,
      actorDeviceId: principal.deviceId,
      action: "wrappedkey.issue",
      targetType: "device",
      targetId: device.id,
      outcome: "allowed",
      metadata: { forMemberId: device.memberId },
    });

    return c.body(null, 204);
  });
}
