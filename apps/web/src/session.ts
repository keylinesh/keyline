/**
 * Dashboard session (ADR-0003): start a web session, poll until the CLI
 * approves it, keep the short-lived token in localStorage.
 */

import { request } from "./api.js";

export interface WebSession {
  token: string;
  expiresAt: string;
  workspaceId: string;
  /** Present on sessions claimed after #40; older stored sessions lack them. */
  memberId?: string;
  role?: "owner" | "admin" | "member";
}

/** Admin-capable sessions may create/rename/delete; members read. */
export function isAdmin(session: WebSession): boolean {
  return session.role === "owner" || session.role === "admin";
}

const STORAGE_KEY = "keyline.web.session";

export interface StartResponse {
  sessionId: string;
  code: string;
  expiresAt: string;
}

export type ClaimResponse =
  | { status: "pending" | "expired" | "consumed" }
  | ({ status: "ready" } & WebSession);

export function startSignIn(fetchImpl?: typeof fetch): Promise<StartResponse> {
  return request<StartResponse>("POST", "/v1/web/sessions", { fetchImpl });
}

export function claimSession(sessionId: string, fetchImpl?: typeof fetch): Promise<ClaimResponse> {
  return request<ClaimResponse>("POST", `/v1/web/sessions/${sessionId}/claim`, { fetchImpl });
}

/** Ask for a sign-in link by email (#68). Always resolves; never reveals accounts. */
export function requestMagicLink(email: string, fetchImpl?: typeof fetch): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("POST", "/v1/web/magic", { fetchImpl, body: { email } });
}

/** Redeem a magic-link token from the URL hash (#ml=...). Throws on bad/expired. */
export function claimMagicLink(token: string, fetchImpl?: typeof fetch): Promise<WebSession> {
  return request<WebSession>("POST", "/v1/web/magic/claim", { fetchImpl, body: { token } });
}

/** The #ml= token from a magic-link URL, if present. */
export function magicTokenFromLocation(hash: string = window.location.hash): string | null {
  const match = /[#&]ml=([A-Za-z0-9_-]{16,})/.exec(hash);
  return match ? match[1]! : null;
}

/**
 * Poll claim until approved, expired, or consumed. Calls `onTick` between
 * polls so the UI can show progress. Resolves with the session on success,
 * null when the code expired (start over).
 */
export async function waitForApproval(
  sessionId: string,
  opts: {
    fetchImpl?: typeof fetch;
    intervalMs?: number;
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<WebSession | null> {
  const interval = opts.intervalMs ?? 2000;
  const maxAttempts = opts.maxAttempts ?? 400; // ~13 min at 2s > code TTL
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  for (let i = 0; i < maxAttempts; i++) {
    const res = await claimSession(sessionId, opts.fetchImpl);
    if (res.status === "ready") {
      const { token, expiresAt, workspaceId, memberId, role } = res;
      return { token, expiresAt, workspaceId, memberId, role };
    }
    if (res.status === "expired" || res.status === "consumed") return null;
    await sleep(interval);
  }
  return null;
}

export function saveSession(session: WebSession, storage: Storage = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function loadSession(storage: Storage = localStorage, now: Date = new Date()): WebSession | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as WebSession;
    if (!session.token || new Date(session.expiresAt).getTime() <= now.getTime()) {
      storage.removeItem(STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    storage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function clearSession(storage: Storage = localStorage): void {
  storage.removeItem(STORAGE_KEY);
}
