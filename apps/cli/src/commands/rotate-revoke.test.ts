import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generateDeviceKeyPair, unwrapWorkspaceKey, wrapWorkspaceKey } from "@keyline/crypto";
import { ApiClient } from "../api-client.js";
import { loadAccount } from "../account.js";
import { loadCredentials } from "../credentials.js";
import { loadDeviceIdentity } from "../device.js";
import { harness, type Harness } from "../test-harness.js";
import { runPush } from "./push.js";
import { runPull } from "./pull.js";
import { runRotate } from "./rotate.js";
import { runRevoke } from "./revoke.js";
import { obtainWorkspaceKey } from "./workspace-key.js";

function ownerApi(h: Harness): ApiClient {
  return new ApiClient({
    baseUrl: "",
    token: loadCredentials(h.deps.store)!.token,
    fetchImpl: h.fetchImpl,
  });
}

test("rotate swaps one value, preserves the rest, and lands in the audit log", async () => {
  const h = await harness();
  try {
    await runPush(h.deps, { dir: h.dir });

    const result = await runRotate(h.deps, { dir: h.dir, name: "API_KEY", value: "sk_live_ROTATED" });
    assert.equal(result.version, 2);
    assert.equal(result.envFileUpdated, join(h.dir, ".env"), "local .env kept in sync");

    // Local file and a fresh pull agree; comments and other keys untouched.
    const local = readFileSync(join(h.dir, ".env"), "utf8");
    assert.match(local, /API_KEY=sk_live_ROTATED/);
    assert.match(local, /# a comment survives round-trips/);
    assert.match(local, /DB_URL=postgres:\/\/localhost\/app/);
    rmSync(join(h.dir, ".env"));
    await runPull(h.deps, { dir: h.dir });
    assert.equal(readFileSync(join(h.dir, ".env"), "utf8"), local);

    // Audit: the secret NAME is recorded, never the value.
    const account = loadAccount(h.deps.store)!;
    const { events } = await ownerApi(h).get<{
      events: Array<{ action: string; metadata: Record<string, unknown> | null }>;
    }>(`/v1/workspaces/${account.workspaceId}/audit`);
    const rotateEvents = events.filter((e) => e.action === "secret.rotate");
    assert.equal(rotateEvents.length, 1);
    assert.equal(rotateEvents[0]!.metadata?.secretName, "API_KEY");
    assert.ok(
      !JSON.stringify(events).includes("sk_live_ROTATED"),
      "the new value never appears in the audit log",
    );
  } finally {
    h.cleanup();
  }
});

test("rotate a key that isn't in the bundle points at push instead", async () => {
  const h = await harness();
  try {
    await runPush(h.deps, { dir: h.dir });
    await assert.rejects(
      () => runRotate(h.deps, { dir: h.dir, name: "NOPE", value: "x" }),
      /keyline push/,
    );
  } finally {
    h.cleanup();
  }
});

test("rotate without a local .env still rotates, writes nothing", async () => {
  const h = await harness();
  try {
    await runPush(h.deps, { dir: h.dir });
    rmSync(join(h.dir, ".env"));
    const result = await runRotate(h.deps, { dir: h.dir, name: "API_KEY", value: "v2" });
    assert.equal(result.envFileUpdated, null);
    assert.equal(existsSync(join(h.dir, ".env")), false);
  } finally {
    h.cleanup();
  }
});

test("rotate validates the secret name", async () => {
  const h = await harness();
  try {
    await assert.rejects(
      () => runRotate(h.deps, { dir: h.dir, name: "BAD NAME", value: "x" }),
      /invalid secret name/,
    );
  } finally {
    h.cleanup();
  }
});

/** Invite a member, register + log in a device for them, grant a wrapped key. */
async function joinMember(h: Harness, email: string) {
  const owner = ownerApi(h);
  const account = loadAccount(h.deps.store)!;
  const member = await owner.post<{ id: string; joinCode: string }>(
    `/v1/workspaces/${account.workspaceId}/members`,
    { email, role: "member" },
  );

  const kp = generateDeviceKeyPair();
  const anon = new ApiClient({ baseUrl: "", fetchImpl: h.fetchImpl });
  const device = await anon.post<{ deviceId: string }>("/v1/join", {
    code: member.joinCode,
    devicePublicKey: kp.publicKey,
  });
  const ch = await anon.post<{ challengeId: string; sealed: never }>(
    "/v1/auth/device/challenge",
    { deviceId: device.deviceId },
  );
  const login = await anon.post<{ token: string }>("/v1/auth/device/login", {
    challengeId: ch.challengeId,
    answer: unwrapWorkspaceKey(ch.sealed, kp.privateKey).toString("base64"),
  });

  // Owner grants the new device the workspace key (the #23/#35 issue flow).
  const identity = loadDeviceIdentity(h.deps.store)!;
  const { key } = await obtainWorkspaceKey(owner, account.deviceId, identity);
  await owner.put(`/v1/devices/${device.deviceId}/wrapped-key`, {
    wrappedKey: wrapWorkspaceKey(key, kp.publicKey),
  });

  return { member, device, token: login.token };
}

test("revoke cuts a member off immediately and lands in the audit log", async () => {
  const h = await harness();
  try {
    await runPush(h.deps, { dir: h.dir });
    const joined = await joinMember(h, "teammate@acme.test");

    // Their token works before the revoke...
    const account = loadAccount(h.deps.store)!;
    const theirApi = new ApiClient({ baseUrl: "", token: joined.token, fetchImpl: h.fetchImpl });
    await theirApi.get(`/v1/workspaces/${account.workspaceId}/members`);

    const result = await runRevoke(h.deps, { email: "Teammate@Acme.test" }); // case-insensitive
    assert.equal(result.tokensRevoked, 1);
    assert.equal(result.devicesRevoked, 1);
    assert.equal(result.wrappedKeysDeleted, 1);

    // ...and is dead afterwards, as is a fresh device login.
    await assert.rejects(
      () => theirApi.get(`/v1/workspaces/${account.workspaceId}/members`),
      (err: Error & { status?: number }) => err.status === 401,
    );
    const anon = new ApiClient({ baseUrl: "", fetchImpl: h.fetchImpl });
    await assert.rejects(
      () => anon.post("/v1/auth/device/challenge", { deviceId: joined.device.deviceId }),
      (err: Error & { status?: number }) => err.status === 401 || err.status === 404,
    );

    const { events } = await ownerApi(h).get<{ events: Array<{ action: string }> }>(
      `/v1/workspaces/${account.workspaceId}/audit`,
    );
    assert.ok(events.some((e) => e.action === "member.revoke"));
  } finally {
    h.cleanup();
  }
});

test("revoke: unknown email and self-revoke are refused", async () => {
  const h = await harness();
  try {
    await assert.rejects(() => runRevoke(h.deps, { email: "ghost@acme.test" }), /No member/);
    await assert.rejects(() => runRevoke(h.deps, { email: "founder@acme.test" }), /lock you out/);
  } finally {
    h.cleanup();
  }
});
