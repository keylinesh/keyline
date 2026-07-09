/**
 * `keyline web <code>` — approve a dashboard sign-in from this device (#39).
 *
 * The dashboard shows a one-time code; this command tells the API to open a
 * short-lived, metadata-scoped browser session for this member (ADR-0003).
 * The browser never gets a device key, and revoking this device or member
 * kills the web session with it.
 */

import { ApiError } from "../api-client.js";
import { resolveSession, type SyncDeps } from "./sync-context.js";

export interface WebApproveResult {
  workspaceId: string;
}

export async function runWebApprove(deps: SyncDeps, code: string): Promise<WebApproveResult> {
  const trimmed = code.trim();
  if (!trimmed) throw new Error("No code given. The dashboard shows one on its sign-in screen.");

  const session = resolveSession(deps);
  try {
    await session.api.post("/v1/web/sessions/approve", { code: trimmed });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new Error(
        "That code isn't valid anymore (expired, mistyped, or already used). Reload the dashboard sign-in page for a fresh one.",
      );
    }
    throw err;
  }
  return { workspaceId: session.account.workspaceId };
}
