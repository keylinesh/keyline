/**
 * Auth routes — device registration and proof-of-possession login (#20).
 *
 * Challenge/login are public (a device has no token yet). Device registration
 * is GATED (#64): a signed-in member may add devices to their OWN membership;
 * new members enroll through a join code (POST /v1/join, #66); brand-new
 * accounts go through /v1/onboard.
 */

import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import { AuthError, type DeviceLoginService } from "../../auth/device-login.js";
import type { JoinService } from "../../domain/join-codes.js";
import { JoinError } from "../../domain/join-codes.js";
import type { AppEnv } from "../authz.js";
import { ApiError } from "../errors.js";
import { parseBody } from "../validate.js";

const registerSchema = z.object({
  publicKey: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
});

const joinSchema = z.object({
  code: z.string().min(1).max(40),
  devicePublicKey: z.string().min(1),
  deviceName: z.string().min(1).max(120).optional(),
});

const challengeSchema = z.object({ deviceId: z.string().uuid() });

const loginSchema = z.object({
  challengeId: z.string().uuid(),
  answer: z.string().min(1),
  environmentIds: z.array(z.string().uuid()).optional(),
});

/** Map a thrown AuthError to a 401 in the standard envelope. */
function asApiError(err: unknown): never {
  if (err instanceof AuthError) throw new ApiError(401, "unauthorized", err.message);
  throw err;
}

export function registerAuthRoutes(
  app: Hono<AppEnv>,
  login: DeviceLoginService,
  join: JoinService,
  auth: MiddlewareHandler<AppEnv>,
): void {
  // #64: adding a device requires a session, and only for your own membership.
  app.post("/v1/devices", auth, async (c) => {
    const input = await parseBody(c, registerSchema);
    const principal = c.get("principal");
    if (!principal.memberId) throw new ApiError(403, "forbidden", "no member on this session");
    const device = await login.register({
      memberId: principal.memberId,
      workspaceId: principal.scope.workspaceId,
      publicKey: input.publicKey,
      role: principal.scope.role,
      name: input.name,
    });
    return c.json({ deviceId: device.id, publicKey: device.publicKey }, 201);
  });

  // #66: an invited teammate enrolls their device with a one-time join code.
  app.post("/v1/join", async (c) => {
    const input = await parseBody(c, joinSchema);
    try {
      const result = await join.redeem(input);
      return c.json(result, 201);
    } catch (err) {
      if (err instanceof JoinError) throw new ApiError(404, "not_found", err.message);
      throw err;
    }
  });

  app.post("/v1/auth/device/challenge", async (c) => {
    const { deviceId } = await parseBody(c, challengeSchema);
    try {
      const { challengeId, sealed } = await login.beginChallenge(deviceId);
      return c.json({ challengeId, sealed });
    } catch (err) {
      asApiError(err);
    }
  });

  app.post("/v1/auth/device/login", async (c) => {
    const input = await parseBody(c, loginSchema);
    try {
      const { token, expiresAt } = await login.completeLogin(input);
      return c.json({ token, expiresAt: expiresAt.toISOString() });
    } catch (err) {
      asApiError(err);
    }
  });
}
