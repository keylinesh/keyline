/**
 * `keyline revoke <email>` — cut a member's access immediately (#34).
 *
 * Server-side (M2 #25): all their tokens are revoked, every device's wrapped
 * workspace key is deleted, and the devices are marked revoked — so they can
 * neither authenticate nor decrypt anything new. The member record and the
 * ciphertext stay. The action lands in the audit log as `member.revoke`.
 *
 * A revoked member may still KNOW current values — the CLI reminds the caller
 * to rotate. Workspace-level command: needs a login, not a linked directory.
 */

import { resolveSession, type SyncDeps } from "./sync-context.js";

export interface RevokeInput {
  email: string;
}

export interface RevokeResult {
  memberId: string;
  email: string;
  tokensRevoked: number;
  devicesRevoked: number;
  wrappedKeysDeleted: number;
}

interface MemberView {
  id: string;
  email: string;
  role: string;
}

export async function runRevoke(deps: SyncDeps, input: RevokeInput): Promise<RevokeResult> {
  const session = resolveSession(deps);

  const { members } = await session.api.get<{ members: MemberView[] }>(
    `/v1/workspaces/${session.account.workspaceId}/members`,
  );
  const email = input.email.trim().toLowerCase();
  const member = members.find((m) => m.email.toLowerCase() === email);
  if (!member) {
    throw new Error(`No member with email ${input.email} in this workspace.`);
  }
  if (member.email.toLowerCase() === session.account.email.toLowerCase()) {
    throw new Error("That's you. Revoking your own access would lock you out.");
  }

  const result = await session.api.post<Omit<RevokeResult, "memberId" | "email">>(
    `/v1/members/${member.id}/revoke`,
  );
  return { memberId: member.id, email: member.email, ...result };
}
