import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "@keyline/api/app";
import { generateDeviceKeyPair, unwrapWorkspaceKey } from "@keyline/crypto";
import { ApiClient } from "../api-client.js";
import type { KeyStore } from "../keystore.js";
import { loadAccount, saveAccount } from "../account.js";
import { loadCredentials, saveCredentials } from "../credentials.js";
import { runLogin } from "./login.js";
import { runLink } from "./link.js";
import { runPush } from "./push.js";
import { runPull } from "./pull.js";
import { NO_ACCESS_MESSAGE, obtainWorkspaceKey } from "./workspace-key.js";

const ENV = "API_KEY=sk_live_x\n# a comment survives round-trips\nDB_URL=postgres://localhost/app\n";

function memStore(): KeyStore {
  const map = new Map<string, string>();
  return {
    backend: "memory",
    get: (a) => map.get(a) ?? null,
    set: (a, s) => void map.set(a, s),
    delete: (a) => void map.delete(a),
  };
}

/** CLI deps on a fresh in-memory API + a linked temp dir with an .env. */
async function harness() {
  const app = buildApp();
  const fetchImpl = ((url: string, init?: RequestInit) =>
    app.request(url, init)) as unknown as typeof fetch;
  const dir = mkdtempSync(join(tmpdir(), "keyline-sync-"));
  const deps = {
    store: memStore(),
    apiBaseUrl: "",
    fetchImpl,
    statePath: join(dir, "state.json"),
  };
  await runLogin(deps, { workspaceName: "Acme", email: "founder@acme.test" });
  await runLink(deps, { project: "api", environment: "prod", dir });
  writeFileSync(join(dir, ".env"), ENV);
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return { deps, dir, fetchImpl, cleanup };
}

test("push then pull round-trips the .env byte-for-byte", async () => {
  const { deps, dir, cleanup } = await harness();
  try {
    const pushed = await runPush(deps, { dir });
    assert.equal(pushed.version, 1);
    assert.equal(pushed.secretCount, 2);
    assert.equal(pushed.bootstrappedKey, true, "first push creates the workspace key");

    rmSync(join(dir, ".env"));
    const pulled = await runPull(deps, { dir });
    assert.equal(pulled.version, 1);
    assert.equal(pulled.secretCount, 2);
    assert.equal(readFileSync(join(dir, ".env"), "utf8"), ENV);
    const mode = statSync(join(dir, ".env")).mode & 0o777;
    assert.equal(mode, 0o600, "pulled .env is 0600");
  } finally {
    cleanup();
  }
});

test("second push reuses the key and bumps the version", async () => {
  const { deps, dir, cleanup } = await harness();
  try {
    await runPush(deps, { dir });
    writeFileSync(join(dir, ".env"), ENV + "NEW=1\n");
    const second = await runPush(deps, { dir });
    assert.equal(second.version, 2);
    assert.equal(second.bootstrappedKey, false);
    assert.equal(second.secretCount, 3);
  } finally {
    cleanup();
  }
});

test("push from a never-synced machine conflicts instead of clobbering; --force overrides", async () => {
  const { deps, dir, cleanup } = await harness();
  try {
    await runPush(deps, { dir });
    // Same binding, but no local sync state — like a second machine that never pulled.
    const fresh = { ...deps, statePath: join(dir, "other-state.json") };
    await assert.rejects(() => runPush(fresh, { dir }), /keyline pull/);
    const forced = await runPush(fresh, { dir, force: true });
    assert.equal(forced.version, 2);
  } finally {
    cleanup();
  }
});

test("pull before any push explains what to do", async () => {
  const { deps, dir, cleanup } = await harness();
  try {
    await assert.rejects(() => runPull(deps, { dir }), /keyline push/);
  } finally {
    cleanup();
  }
});

test("push --file targets another env file", async () => {
  const { deps, dir, cleanup } = await harness();
  try {
    writeFileSync(join(dir, ".env.staging"), "ONLY=one\n");
    const pushed = await runPush(deps, { dir, file: ".env.staging" });
    assert.equal(pushed.secretCount, 1);
    rmSync(join(dir, ".env.staging"));
    await runPull(deps, { dir, file: ".env.staging" });
    assert.equal(readFileSync(join(dir, ".env.staging"), "utf8"), "ONLY=one\n");
  } finally {
    cleanup();
  }
});

test("a device without a wrapped key is told to ask an admin (no key regeneration)", async () => {
  const { deps, dir, fetchImpl, cleanup } = await harness();
  try {
    await runPush(deps, { dir }); // workspace key now exists, wrapped to device 1

    // Register a second device for the same member and log it in — it has no
    // wrapped key, so it must NOT silently bootstrap a second workspace key.
    const account = loadAccount(deps.store)!;
    const creds = loadCredentials(deps.store)!;
    const owner = new ApiClient({ baseUrl: "", token: creds.token, fetchImpl });
    const { members } = await owner.get<{ members: Array<{ id: string }> }>(
      `/v1/workspaces/${account.workspaceId}/members`,
    );

    const kp = generateDeviceKeyPair();
    const anon = new ApiClient({ baseUrl: "", fetchImpl });
    const reg = await anon.post<{ deviceId: string }>("/v1/devices", {
      memberId: members[0]!.id,
      workspaceId: account.workspaceId,
      publicKey: kp.publicKey,
      role: "owner",
    });
    const ch = await anon.post<{ challengeId: string; sealed: never }>(
      "/v1/auth/device/challenge",
      { deviceId: reg.deviceId },
    );
    const answer = unwrapWorkspaceKey(ch.sealed, kp.privateKey).toString("base64");
    const login = await anon.post<{ token: string; expiresAt: string }>("/v1/auth/device/login", {
      challengeId: ch.challengeId,
      answer,
    });

    const store2 = memStore();
    saveAccount({ deviceId: reg.deviceId, workspaceId: account.workspaceId, email: account.email }, store2);
    saveCredentials({ token: login.token, expiresAt: login.expiresAt }, store2);
    const api2 = new ApiClient({ baseUrl: "", token: login.token, fetchImpl });
    await assert.rejects(
      () =>
        obtainWorkspaceKey(api2, reg.deviceId, {
          deviceId: "local-2",
          publicKey: kp.publicKey,
          privateKey: kp.privateKey,
        }),
      new RegExp(NO_ACCESS_MESSAGE.slice(0, 30)),
    );
  } finally {
    cleanup();
  }
});
