/**
 * `keyline join <code>` — enroll this device into an existing workspace (#66).
 *
 * An admin invites you and shares a one-time join code (Members page or
 * `keyline members invite`). Redeeming it registers THIS device under your
 * membership, then logs in with proof of possession. The private key never
 * leaves the device.
 */

import { unwrapWorkspaceKey } from "@keyline/crypto";
import { ApiClient } from "../api-client.js";
import type { KeyStore } from "../keystore.js";
import { loadOrCreateDeviceIdentity } from "../device.js";
import { loadAccount, saveAccount } from "../account.js";
import { saveCredentials } from "../credentials.js";

export interface JoinDeps {
  apiBaseUrl: string;
  store: KeyStore;
  fetchImpl?: typeof fetch;
}

export interface JoinResult {
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: string;
  deviceId: string;
  keyStorage: string;
}

interface JoinResponse {
  workspaceId: string;
  workspaceName: string;
  memberId: string;
  deviceId: string;
  email: string;
  role: string;
}
interface ChallengeResponse {
  challengeId: string;
  sealed: Parameters<typeof unwrapWorkspaceKey>[0];
}
interface LoginResponse {
  token: string;
  expiresAt: string;
}

export async function runJoin(deps: JoinDeps, code: string): Promise<JoinResult> {
  const { store } = deps;
  const existing = loadAccount(store);
  if (existing) {
    throw new Error(
      `This device already belongs to a workspace (${existing.email}).\n` +
        "Run `keyline login --reset` first if you really want to switch.",
    );
  }

  const { identity } = loadOrCreateDeviceIdentity(store);
  const api = new ApiClient({ baseUrl: deps.apiBaseUrl, fetchImpl: deps.fetchImpl });

  const joined = await api.post<JoinResponse>("/v1/join", {
    code,
    devicePublicKey: identity.publicKey,
  });
  saveAccount(
    { deviceId: joined.deviceId, workspaceId: joined.workspaceId, email: joined.email },
    store,
  );

  // Same proof-of-possession login as `keyline login`.
  const challenge = await api.post<ChallengeResponse>("/v1/auth/device/challenge", {
    deviceId: joined.deviceId,
  });
  const answer = unwrapWorkspaceKey(challenge.sealed, identity.privateKey).toString("base64");
  const login = await api.post<LoginResponse>("/v1/auth/device/login", {
    challengeId: challenge.challengeId,
    answer,
  });
  saveCredentials(
    { token: login.token, expiresAt: login.expiresAt, workspaceId: joined.workspaceId },
    store,
  );

  return {
    workspaceId: joined.workspaceId,
    workspaceName: joined.workspaceName,
    email: joined.email,
    role: joined.role,
    deviceId: joined.deviceId,
    keyStorage: store.backend,
  };
}
