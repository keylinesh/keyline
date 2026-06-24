/**
 * Auth routes — device registration and proof-of-possession login (#20).
 *
 * These are public (a device has no token yet). Device registration is the
 * onboarding seam: gating it behind member enrollment lands with #23 / signup.
 */

import type { Hono } from "hono";
import { z } from "zod";
import { AuthError, type DeviceLoginService } from "../../auth/device-login.js";
import type { AppEnv } from "../authz.js";
import { ApiError } from "../errors.js";
import { parseBody } from "../validate.js";

const roleSchema = z.enum(["owner", "admin", "member"]);

const registerSchema = z.object({
  memberId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  publicKey: z.string().min(1),
  role: roleSchema,
  name: z.string().min(1).max(120).optional(),
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

export function registerAuthRoutes(app: Hono<AppEnv>, login: DeviceLoginService): void {
  app.post("/v1/devices", async (c) => {
    const input = await parseBody(c, registerSchema);
    const device = await login.register(input);
    return c.json({ deviceId: device.id, publicKey: device.publicKey }, 201);
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
