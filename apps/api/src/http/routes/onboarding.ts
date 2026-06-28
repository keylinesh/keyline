/**
 * Onboarding (#60) — bootstrap a brand-new account.
 *
 *   POST /v1/onboard  (public)
 *
 * Creates a workspace (with its KDF salt), a first **owner** member, and
 * registers the caller's device public key — the minimum needed for a new user
 * to then run the proof-of-possession login (#20) and get a scoped token.
 *
 * Open signup for now (no email verification / invite gate — tracked as #64).
 * The server only ever sees the device PUBLIC key and the non-secret salt.
 */

import type { Hono } from "hono";
import { z } from "zod";
import type { DeviceLoginService } from "../../auth/device-login.js";
import type { AuditService } from "../../domain/audit.js";
import type { MemberRepo } from "../../domain/members.js";
import type { WorkspaceRepo } from "../../domain/resources.js";
import type { AppEnv } from "../authz.js";
import { parseBody } from "../validate.js";

export interface OnboardingDeps {
  workspaces: WorkspaceRepo;
  members: MemberRepo;
  login: DeviceLoginService;
  audit: AuditService;
}

const name = z.string().min(1).max(120);
const b64 = z.string().min(1);

const onboardSchema = z.object({
  workspaceName: name,
  kdfSalt: b64,
  email: z.string().email(),
  displayName: name.optional(),
  devicePublicKey: b64,
  deviceName: name.optional(),
});

export function registerOnboardingRoutes(app: Hono<AppEnv>, deps: OnboardingDeps): void {
  app.post("/v1/onboard", async (c) => {
    const input = await parseBody(c, onboardSchema);

    const workspace = await deps.workspaces.create({
      name: input.workspaceName,
      kdfSalt: input.kdfSalt,
    });
    const member = await deps.members.create({
      workspaceId: workspace.id,
      email: input.email,
      role: "owner",
      displayName: input.displayName,
    });
    const device = await deps.login.register({
      memberId: member.id,
      workspaceId: workspace.id,
      publicKey: input.devicePublicKey,
      role: "owner",
      name: input.deviceName,
    });

    await deps.audit.record({
      workspaceId: workspace.id,
      actorMemberId: member.id,
      actorDeviceId: device.id,
      action: "workspace.onboard",
      targetType: "workspace",
      targetId: workspace.id,
      outcome: "allowed",
      metadata: { email: member.email },
    });

    return c.json(
      {
        workspaceId: workspace.id,
        memberId: member.id,
        deviceId: device.id,
        publicKey: device.publicKey,
      },
      201,
    );
  });
}
