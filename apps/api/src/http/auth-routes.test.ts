import { test } from "node:test";
import assert from "node:assert/strict";
import { generateDeviceKeyPair, unwrapWorkspaceKey, type WrappedKey } from "@keyline/crypto";
import { createApp } from "./app.js";
import { memoryDeps } from "../deps.js";

/** Read a response body as JSON without fighting the `unknown` return type. */
const readJson = (r: Response): Promise<any> => r.json();
const SALT = Buffer.from("0123456789abcdef").toString("base64");

const jsonReq =
  (app: ReturnType<typeof createApp>) =>
  (method: string, path: string, body?: unknown, token?: string) =>
    app.request(path, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

/** The full proof-of-possession login for a registered device. */
async function loginDevice(json: ReturnType<typeof jsonReq>, deviceId: string, privateKey: string) {
  const { challengeId, sealed } = (await readJson(
    await json("POST", "/v1/auth/device/challenge", { deviceId }),
  )) as { challengeId: string; sealed: WrappedKey };
  const answer = unwrapWorkspaceKey(sealed, privateKey).toString("base64");
  const res = await json("POST", "/v1/auth/device/login", { challengeId, answer });
  return readJson(res);
}

test("join code → device register → challenge → login issues a usable token (#66)", async () => {
  const deps = memoryDeps();
  const app = createApp(deps);
  const json = jsonReq(app);

  // An existing workspace invites a teammate; the invite mints a join code.
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  await deps.workspaces.update(ws.id, { plan: "team" });
  const adminTok = (await deps.tokens.issue({
    deviceId: "dev-a", memberId: "mem-a", scope: { workspaceId: ws.id, role: "admin" },
  })).token;
  const invite = await readJson(
    await json("POST", `/v1/workspaces/${ws.id}/members`, { email: "t@acme.test", role: "member" }, adminTok),
  );
  assert.match(invite.joinCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  // The teammate redeems it (case/format-insensitively) with their device key.
  const kp = generateDeviceKeyPair();
  const joinRes = await json("POST", "/v1/join", {
    code: invite.joinCode.toLowerCase().replaceAll("-", " "),
    devicePublicKey: kp.publicKey,
    deviceName: "teammate-laptop",
  });
  assert.equal(joinRes.status, 201);
  const joined = await readJson(joinRes);
  assert.equal(joined.workspaceId, ws.id);
  assert.equal(joined.workspaceName, "Acme");
  assert.equal(joined.email, "t@acme.test");

  // Proof-of-possession login works and the token reaches protected routes.
  const { token } = await loginDevice(json, joined.deviceId, kp.privateKey);
  assert.ok(typeof token === "string" && token.startsWith("klk_"));
  assert.equal((await json("GET", "/v1/workspaces", undefined, token)).status, 200);

  // Codes are one-time, and the join landed in the audit log.
  const again = await json("POST", "/v1/join", { code: invite.joinCode, devicePublicKey: kp.publicKey });
  assert.equal(again.status, 404);
  const log = await readJson(await json("GET", `/v1/workspaces/${ws.id}/audit`, undefined, adminTok));
  assert.ok(log.events.some((e: any) => e.action === "member.join"));
});

test("regenerating a join code invalidates the old one (#66)", async () => {
  const deps = memoryDeps();
  const app = createApp(deps);
  const json = jsonReq(app);
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  await deps.workspaces.update(ws.id, { plan: "team" });
  const adminTok = (await deps.tokens.issue({
    deviceId: "dev-a", memberId: "mem-a", scope: { workspaceId: ws.id, role: "admin" },
  })).token;
  const invite = await readJson(
    await json("POST", `/v1/workspaces/${ws.id}/members`, { email: "t@acme.test", role: "member" }, adminTok),
  );
  const regen = await readJson(await json("POST", `/v1/members/${invite.id}/join-code`, {}, adminTok));
  assert.notEqual(regen.joinCode, invite.joinCode);

  const kp = generateDeviceKeyPair();
  assert.equal(
    (await json("POST", "/v1/join", { code: invite.joinCode, devicePublicKey: kp.publicKey })).status,
    404,
    "old code is dead",
  );
  assert.equal(
    (await json("POST", "/v1/join", { code: regen.joinCode, devicePublicKey: kp.publicKey })).status,
    201,
    "new code works",
  );
});

test("device registration is gated (#64): 401 anonymous, self-membership when signed in", async () => {
  const deps = memoryDeps();
  const app = createApp(deps);
  const json = jsonReq(app);
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  const tok = (await deps.tokens.issue({
    deviceId: "dev-a", memberId: "mem-a", scope: { workspaceId: ws.id, role: "member" },
  })).token;

  const kp = generateDeviceKeyPair();
  assert.equal((await json("POST", "/v1/devices", { publicKey: kp.publicKey })).status, 401);

  const res = await json("POST", "/v1/devices", { publicKey: kp.publicKey, name: "second laptop" }, tok);
  assert.equal(res.status, 201);
  const { deviceId } = await readJson(res);
  const device = await deps.devices.findById(deviceId);
  assert.equal(device?.memberId, "mem-a", "registered under the caller's own membership");
  assert.equal(device?.workspaceId, ws.id);
});

test("a bad challenge answer is rejected (401)", async () => {
  const deps = memoryDeps();
  const app = createApp(deps);
  const json = jsonReq(app);
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  const tok = (await deps.tokens.issue({
    deviceId: "dev-a", memberId: "mem-a", scope: { workspaceId: ws.id, role: "member" },
  })).token;
  const kp = generateDeviceKeyPair();
  const reg = await readJson(await json("POST", "/v1/devices", { publicKey: kp.publicKey }, tok));
  const { challengeId } = await readJson(
    await json("POST", "/v1/auth/device/challenge", { deviceId: reg.deviceId }),
  );
  const res = await json("POST", "/v1/auth/device/login", {
    challengeId,
    answer: Buffer.alloc(32, 0).toString("base64"),
  });
  assert.equal(res.status, 401);
});
