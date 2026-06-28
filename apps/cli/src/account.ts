/**
 * Account record — the server-assigned ids this device is bound to.
 *
 * Kept separate from the access token (credentials.ts, clearable on logout) and
 * the device keypair (device.ts). It persists the SERVER deviceId (the keypair's
 * local id is not the server's) + workspace, so re-login re-authenticates the
 * same device instead of creating a duplicate account.
 */

import { type KeyStore, openKeyStore } from "./keystore.js";

const ACCOUNT = "account";

export interface StoredAccount {
  /** Server-assigned device id (used for the login challenge). */
  deviceId: string;
  workspaceId: string;
  email: string;
}

export function saveAccount(account: StoredAccount, store: KeyStore = openKeyStore()): void {
  store.set(ACCOUNT, JSON.stringify(account));
}

export function loadAccount(store: KeyStore = openKeyStore()): StoredAccount | null {
  const raw = store.get(ACCOUNT);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAccount;
  } catch {
    return null;
  }
}

export function clearAccount(store: KeyStore = openKeyStore()): void {
  store.delete(ACCOUNT);
}
