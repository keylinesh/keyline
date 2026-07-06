/**
 * `keyline members` — see and manage who can reach what (#35).
 *
 *   members                 list members (+ per-env roles with --env)
 *   members invite <email>  add a member to the workspace
 *   members grant <email>   give an env role AND wrap the workspace key to
 *                           the member's devices so they can actually decrypt
 *
 * The grant is the crypto heart of the team flow (user-flows.md §4): the
 * workspace key is unwrapped with OUR device key and re-wrapped to each of the
 * member's registered devices, client-side. No bundle is re-encrypted and the
 * server never sees the key.
 */

import { wrapWorkspaceKey } from "@keyline/crypto";
import { obtainWorkspaceKey } from "./workspace-key.js";
import {
  resolveSession,
  resolveSyncContext,
  type Session,
  type SyncDeps,
  type SyncInput,
} from "./sync-context.js";

export interface MemberView {
  id: string;
  email: string;
  displayName?: string | null;
  role: string;
}

interface EnvAccessView {
  memberId: string;
  role: string;
}

interface DeviceView {
  id: string;
  publicKey: string;
  revoked: boolean;
  hasWrappedKey: boolean;
}

export const ENV_ROLES = ["read", "write", "admin"] as const;
export type EnvRole = (typeof ENV_ROLES)[number];

async function listMembers(session: Session): Promise<MemberView[]> {
  const { members } = await session.api.get<{ members: MemberView[] }>(
    `/v1/workspaces/${session.account.workspaceId}/members`,
  );
  return members;
}

async function findMember(session: Session, email: string): Promise<MemberView> {
  const members = await listMembers(session);
  const member = members.find((m) => m.email.toLowerCase() === email.trim().toLowerCase());
  if (!member) throw new Error(`No member with email ${email} in this workspace.`);
  return member;
}

/** Resolve an environment by name inside the linked project. */
async function resolveEnvironment(deps: SyncDeps, input: SyncInput & { env: string }) {
  const ctx = resolveSyncContext(deps, input);
  const { environments } = await ctx.api.get<{ environments: Array<{ id: string; name: string }> }>(
    `/v1/projects/${ctx.binding.projectId}/environments`,
  );
  const env = environments.find((e) => e.name === input.env);
  if (!env) {
    const names = environments.map((e) => e.name).join(", ") || "none";
    throw new Error(`No environment "${input.env}" in this project (have: ${names}).`);
  }
  return { ctx, env };
}

// ---- list ----

export interface MembersListInput extends SyncInput {
  /** Also show each member's role for this environment (linked project). */
  env?: string;
}

export interface MemberRow extends MemberView {
  /** Set when --env was given: the member's explicit role there, if any. */
  envRole?: string | null;
}

export async function runMembersList(
  deps: SyncDeps,
  input: MembersListInput = {},
): Promise<{ members: MemberRow[]; env?: string }> {
  if (!input.env) {
    return { members: await listMembers(resolveSession(deps)) };
  }
  const { ctx, env } = await resolveEnvironment(deps, { ...input, env: input.env });
  const [members, { access }] = await Promise.all([
    listMembers(ctx),
    ctx.api.get<{ access: EnvAccessView[] }>(`/v1/environments/${env.id}/access`),
  ]);
  const byMember = new Map(access.map((a) => [a.memberId, a.role]));
  return {
    members: members.map((m) => ({ ...m, envRole: byMember.get(m.id) ?? null })),
    env: env.name,
  };
}

// ---- invite ----

export interface InviteInput {
  email: string;
  role?: "member" | "admin";
}

export async function runInvite(deps: SyncDeps, input: InviteInput): Promise<MemberView> {
  const session = resolveSession(deps);
  return session.api.post<MemberView>(`/v1/workspaces/${session.account.workspaceId}/members`, {
    email: input.email.trim(),
    role: input.role ?? "member",
  });
}

// ---- grant ----

export interface GrantInput extends SyncInput {
  email: string;
  env: string;
  role: EnvRole;
}

export interface GrantResult {
  email: string;
  env: string;
  role: EnvRole;
  /** Devices that newly received a wrapped workspace key. */
  keysIssued: number;
  /** Member has no registered device yet — they can't decrypt until they do. */
  memberHasNoDevice: boolean;
}

export async function runGrant(deps: SyncDeps, input: GrantInput): Promise<GrantResult> {
  if (!ENV_ROLES.includes(input.role)) {
    throw new Error(`role must be one of: ${ENV_ROLES.join(", ")}`);
  }
  const { ctx, env } = await resolveEnvironment(deps, input);
  const member = await findMember(ctx, input.email);

  await ctx.api.put(`/v1/environments/${env.id}/access`, {
    memberId: member.id,
    role: input.role,
  });

  // The role lets them through authorization; the wrapped key lets them
  // decrypt. Wrap to every active device that doesn't have one yet.
  const { devices } = await ctx.api.get<{ devices: DeviceView[] }>(
    `/v1/members/${member.id}/devices`,
  );
  const needKey = devices.filter((d) => !d.revoked && !d.hasWrappedKey);
  let keysIssued = 0;
  if (needKey.length > 0) {
    const { key } = await obtainWorkspaceKey(ctx.api, ctx.account.deviceId, ctx.identity);
    for (const device of needKey) {
      await ctx.api.put(`/v1/devices/${device.id}/wrapped-key`, {
        wrappedKey: wrapWorkspaceKey(key, device.publicKey),
      });
      keysIssued++;
    }
  }

  return {
    email: member.email,
    env: env.name,
    role: input.role,
    keysIssued,
    memberHasNoDevice: devices.filter((d) => !d.revoked).length === 0,
  };
}

/** Guard against typo'd role values coming from the CLI layer. */
export function parseEnvRole(value: string): EnvRole {
  if ((ENV_ROLES as readonly string[]).includes(value)) return value as EnvRole;
  throw new Error(`role must be one of: ${ENV_ROLES.join(", ")} (got "${value}")`);
}
