/**
 * `keyline login` — authenticate this device and store a scoped token.
 *
 * First run (no local account): onboards a new workspace (needs --workspace +
 * --email), which creates the workspace + owner member + registers this device.
 * Every run then proves possession of the device private key by unsealing a
 * server challenge (envelope) and exchanges it for a short-lived token.
 *
 * The private key never leaves the device; the server only sees the public key.
 */

import { randomBytes } from "node:crypto";
import { unwrapWorkspaceKey } from "@keyline/crypto";
import { ApiClient } from "../api-client.js";
import type { KeyStore } from "../keystore.js";
import { clearDeviceIdentity, loadOrCreateDeviceIdentity } from "../device.js";
import { clearAccount, loadAccount, saveAccount } from "../account.js";
import { clearCredentials, saveCredentials } from "../credentials.js";

export interface LoginInput {
  workspaceName?: string;
  email?: string;
  reset?: boolean;
}

export interface LoginDeps {
  apiBaseUrl: string;
  store: KeyStore;
  fetchImpl?: typeof fetch;
}

export interface LoginResult {
  workspaceId: string;
  deviceId: string;
  created: boolean;
  keyStorage: string;
}

interface OnboardResponse {
  workspaceId: string;
  memberId: string;
  deviceId: string;
  publicKey: string;
}
interface ChallengeResponse {
  challengeId: string;
  sealed: Parameters<typeof unwrapWorkspaceKey>[0];
}
interface LoginResponse {
  token: string;
  expiresAt: string;
}

export async function runLogin(deps: LoginDeps, input: LoginInput): Promise<LoginResult> {
  const { store } = deps;
  if (input.reset) {
    clearCredentials(store);
    clearAccount(store);
    clearDeviceIdentity(store);
  }

  const { identity } = loadOrCreateDeviceIdentity(store);
  const api = new ApiClient({ baseUrl: deps.apiBaseUrl, fetchImpl: deps.fetchImpl });

  let account = loadAccount(store);
  let created = false;
  if (!account) {
    if (!input.workspaceName || !input.email) {
      throw new Error(
        "No account on this device. To create one, run:\n" +
          "  keyline login --workspace <name> --email <you@example.com>",
      );
    }
    const onboard = await api.post<OnboardResponse>("/v1/onboard", {
      workspaceName: input.workspaceName,
      kdfSalt: randomBytes(16).toString("base64"),
      email: input.email,
      devicePublicKey: identity.publicKey,
    });
    account = { deviceId: onboard.deviceId, workspaceId: onboard.workspaceId, email: input.email };
    saveAccount(account, store);
    created = true;
  }

  // Proof of possession: unseal the challenge with the device private key.
  const challenge = await api.post<ChallengeResponse>("/v1/auth/device/challenge", {
    deviceId: account.deviceId,
  });
  const answer = unwrapWorkspaceKey(challenge.sealed, identity.privateKey).toString("base64");
  const login = await api.post<LoginResponse>("/v1/auth/device/login", {
    challengeId: challenge.challengeId,
    answer,
  });

  saveCredentials(
    { token: login.token, expiresAt: login.expiresAt, workspaceId: account.workspaceId },
    store,
  );

  return {
    workspaceId: account.workspaceId,
    deviceId: account.deviceId,
    created,
    keyStorage: store.backend,
  };
}
