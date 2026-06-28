/**
 * Access-token storage — kept in the OS keychain (file fallback), same store as
 * the device identity (keystore.ts). The token is short-lived and scoped; the
 * device proves possession to obtain a new one (`keyline login`, #31).
 */

import { type KeyStore, openKeyStore } from "./keystore.js";

const ACCOUNT = "access-token";

export interface StoredCredentials {
  token: string;
  expiresAt?: string;
  workspaceId?: string;
}

export function saveCredentials(creds: StoredCredentials, store: KeyStore = openKeyStore()): void {
  store.set(ACCOUNT, JSON.stringify(creds));
}

export function loadCredentials(store: KeyStore = openKeyStore()): StoredCredentials | null {
  const raw = store.get(ACCOUNT);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return null;
  }
}

export function clearCredentials(store: KeyStore = openKeyStore()): void {
  store.delete(ACCOUNT);
}

/** A token is usable if present and not past its expiry. */
export function isCredentialValid(
  creds: StoredCredentials | null,
  now: Date = new Date(),
): creds is StoredCredentials {
  if (!creds?.token) return false;
  if (creds.expiresAt && new Date(creds.expiresAt).getTime() <= now.getTime()) return false;
  return true;
}
