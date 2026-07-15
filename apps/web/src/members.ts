/**
 * Member metadata for the dashboard (#41): list, invite, per-environment
 * grants, one-click revoke, and each member's device/key status.
 *
 * ZK boundary note (ADR-0002/0003): the browser can grant an environment ROLE,
 * but it cannot issue the wrapped workspace KEY — only a CLI holding the key
 * can (`keyline members grant`). The UI surfaces key status honestly instead
 * of pretending.
 */

import { request } from "./api.js";
import { listProjects, type Environment } from "./resources.js";
import type { WebSession } from "./session.js";

export interface Member {
  id: string;
  email: string;
  displayName: string | null;
  role: "owner" | "admin" | "member";
  createdAt: string;
}

export type MemberStatus = "invited" | "active" | "revoked";

export interface DeviceView {
  id: string;
  publicKey: string;
  revoked: boolean;
  hasWrappedKey: boolean;
}

export interface EnvOption extends Environment {
  projectSlug: string;
  /** "project/env" label for selectors and chips. */
  label: string;
}

export interface Grant {
  env: EnvOption;
  role: "read" | "write" | "admin";
}

const auth = (s: WebSession) => ({ token: s.token });

/** The whole Members page in one request (admin-only). */
export interface MembersOverview {
  environments: EnvOption[];
  members: Array<
    Member & {
      status: MemberStatus;
      keyed: boolean;
      grants: Array<{ environmentId: string; role: Grant["role"] }>;
    }
  >;
}

export function membersOverview(s: WebSession): Promise<MembersOverview> {
  return request<MembersOverview>("GET", `/v1/workspaces/${s.workspaceId}/members/overview`, auth(s));
}

export async function listMembers(s: WebSession): Promise<Member[]> {
  const { members } = await request<{ members: Member[] }>(
    "GET",
    `/v1/workspaces/${s.workspaceId}/members`,
    auth(s),
  );
  return members;
}

export interface Invited extends Member {
  joinCode: string;
  joinCodeExpiresAt: string;
  emailSent: boolean;
}

export function invite(s: WebSession, email: string, role: "member" | "admin"): Promise<Invited> {
  return request<Invited>("POST", `/v1/workspaces/${s.workspaceId}/members`, {
    ...auth(s),
    body: { email: email.trim(), role },
  });
}

/** Mint a fresh join code for an invited member; the old one dies (#66). */
export function regenerateJoinCode(
  s: WebSession,
  memberId: string,
): Promise<{ joinCode: string; joinCodeExpiresAt: string; emailSent: boolean }> {
  return request("POST", `/v1/members/${memberId}/join-code`, { ...auth(s), body: {} });
}

export interface RevokeCounts {
  tokensRevoked: number;
  devicesRevoked: number;
  wrappedKeysDeleted: number;
}

export function revokeMember(s: WebSession, memberId: string): Promise<RevokeCounts> {
  return request<RevokeCounts>("POST", `/v1/members/${memberId}/revoke`, auth(s));
}

export async function memberDevices(s: WebSession, memberId: string): Promise<DeviceView[]> {
  const { devices } = await request<{ devices: DeviceView[] }>(
    "GET",
    `/v1/members/${memberId}/devices`,
    auth(s),
  );
  return devices;
}

export function statusOf(devices: DeviceView[]): MemberStatus {
  if (devices.length === 0) return "invited";
  return devices.some((d) => !d.revoked) ? "active" : "revoked";
}

export function hasKey(devices: DeviceView[]): boolean {
  return devices.some((d) => !d.revoked && d.hasWrappedKey);
}

/** Every environment in the workspace, labeled "project/env". */
export async function envCatalog(s: WebSession): Promise<EnvOption[]> {
  const projects = await listProjects(s); // environments come embedded
  return projects.flatMap((p) =>
    (p.environments ?? []).map((e) => ({
      ...e,
      projectSlug: p.slug,
      label: `${p.slug}/${e.name}`,
    })),
  );
}

/** memberId → grants, built by listing access for every environment (admin). */
export async function grantsByMember(
  s: WebSession,
  envs: EnvOption[],
): Promise<Map<string, Grant[]>> {
  const map = new Map<string, Grant[]>();
  await Promise.all(
    envs.map(async (env) => {
      const { access } = await request<{ access: Array<{ memberId: string; role: Grant["role"] }> }>(
        "GET",
        `/v1/environments/${env.id}/access`,
        auth(s),
      );
      for (const a of access) {
        const list = map.get(a.memberId) ?? [];
        list.push({ env, role: a.role });
        map.set(a.memberId, list);
      }
    }),
  );
  for (const grants of map.values()) grants.sort((a, b) => a.env.label.localeCompare(b.env.label));
  return map;
}

export function grantAccess(
  s: WebSession,
  envId: string,
  memberId: string,
  role: Grant["role"],
): Promise<unknown> {
  return request("PUT", `/v1/environments/${envId}/access`, {
    ...auth(s),
    body: { memberId, role },
  });
}

export function revokeAccess(s: WebSession, envId: string, memberId: string): Promise<void> {
  return request<void>("DELETE", `/v1/environments/${envId}/access/${memberId}`, auth(s));
}
