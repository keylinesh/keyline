import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateDeviceKeyPair,
  generateWorkspaceKey,
  wrapWorkspaceKey,
  unwrapWorkspaceKey,
  sealBundle,
  openBundle,
} from "@keyline/crypto";
import { createApp, type AppDeps } from "./app.js";
import { memoryDeps } from "../deps.js";

const readJson = (r: Response): Promise<any> => r.json();
const SALT = Buffer.from("0123456789abcdef").toString("base64");

function client(app: ReturnType<typeof createApp>, token?: string) {
  return (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
}

test("onboard creates workspace + owner member + device (public endpoint)", async () => {
  const app = createApp(memoryDeps());
  const kp = generateDeviceKeyPair();
  const res = await client(app)("POST", "/v1/onboard", {
    workspaceName: "Acme",
    kdfSalt: SALT,
    email: "founder@acme.test",
    devicePublicKey: kp.publicKey,
  });
  assert.equal(res.status, 201);
  const body = await readJson(res);
  assert.ok(body.workspaceId && body.memberId && body.deviceId);
  assert.equal(body.publicKey, kp.publicKey);
});

test("onboard validates input", async () => {
  const app = createApp(memoryDeps());
  const res = await client(app)("POST", "/v1/onboard", { workspaceName: "" });
  assert.equal(res.status, 422);
});

test("full bootstrap: onboard -> login -> issue wrapped key -> pull -> decrypt", async () => {
  const deps: AppDeps = memoryDeps();
  const app = createApp(deps);
  const device = generateDeviceKeyPair();

  // 1. onboard
  const onboard = await readJson(
    await client(app)("POST", "/v1/onboard", {
      workspaceName: "Acme",
      kdfSalt: SALT,
      email: "founder@acme.test",
      devicePublicKey: device.publicKey,
    }),
  );

  // 2. login (proof of possession)
  const ch = await readJson(
    await client(app)("POST", "/v1/auth/device/challenge", { deviceId: onboard.deviceId }),
  );
  const answer = unwrapWorkspaceKey(ch.sealed, device.privateKey).toString("base64");
  const { token } = await readJson(
    await client(app)("POST", "/v1/auth/device/login", { challengeId: ch.challengeId, answer }),
  );
  const c = client(app, token);

  // 3. set up a project + environment, and push a sealed bundle
  const project = await readJson(
    await c("POST", `/v1/workspaces/${onboard.workspaceId}/projects`, { name: "API", slug: "api" }),
  );
  const env = await readJson(
    await c("POST", `/v1/projects/${project.id}/environments`, { name: "prod" }),
  );
  const workspaceKey = generateWorkspaceKey();
  const sealed = sealBundle("API_KEY=sk_live_x", workspaceKey);
  assert.equal((await c("PUT", `/v1/environments/${env.id}/bundle`, { bundle: sealed })).status, 201);

  // 4. issue this device its wrapped workspace key (owner issuing to self)
  const wk = wrapWorkspaceKey(workspaceKey, device.publicKey);
  const issue = await c("PUT", `/v1/devices/${onboard.deviceId}/wrapped-key`, {
    wrappedKey: { v: wk.v, eph: wk.eph, nonce: wk.nonce, ct: wk.ct, tag: wk.tag },
  });
  assert.equal(issue.status, 204);

  // 5. pull returns the bundle + wrapped key; unwrap -> decrypt back to plaintext
  const pulled = await readJson(await c("GET", `/v1/environments/${env.id}/bundle`));
  assert.ok(pulled.wrappedKey, "device now has a wrapped key");
  const recoveredKey = unwrapWorkspaceKey(
    { v: pulled.wrappedKey.v, eph: pulled.wrappedKey.eph, nonce: pulled.wrappedKey.nonce, ct: pulled.wrappedKey.ct, tag: pulled.wrappedKey.tag },
    device.privateKey,
  );
  const plaintext = openBundle(
    { v: pulled.bundle.v, nonce: pulled.bundle.nonce, ciphertext: pulled.bundle.ciphertext, tag: pulled.bundle.tag },
    recoveredKey,
  );
  assert.equal(plaintext.toString("utf8"), "API_KEY=sk_live_x");
});

test("GET wrapped-key distinguishes fresh workspace / granted / not granted", async () => {
  const deps: AppDeps = memoryDeps();
  const app = createApp(deps);
  const device = generateDeviceKeyPair();

  const onboard = await readJson(
    await client(app)("POST", "/v1/onboard", {
      workspaceName: "Acme",
      kdfSalt: SALT,
      email: "founder@acme.test",
      devicePublicKey: device.publicKey,
    }),
  );
  const ch = await readJson(
    await client(app)("POST", "/v1/auth/device/challenge", { deviceId: onboard.deviceId }),
  );
  const answer = unwrapWorkspaceKey(ch.sealed, device.privateKey).toString("base64");
  const { token } = await readJson(
    await client(app)("POST", "/v1/auth/device/login", { challengeId: ch.challengeId, answer }),
  );
  const c = client(app, token);

  // Fresh workspace: no key anywhere → the caller may bootstrap one.
  let res = await readJson(await c("GET", `/v1/devices/${onboard.deviceId}/wrapped-key`));
  assert.equal(res.wrappedKey, null);
  assert.equal(res.workspaceHasKey, false);

  // Issue this device its key → GET returns it.
  const wk = wrapWorkspaceKey(generateWorkspaceKey(), device.publicKey);
  await c("PUT", `/v1/devices/${onboard.deviceId}/wrapped-key`, {
    wrappedKey: { v: wk.v, eph: wk.eph, nonce: wk.nonce, ct: wk.ct, tag: wk.tag },
  });
  res = await readJson(await c("GET", `/v1/devices/${onboard.deviceId}/wrapped-key`));
  assert.deepEqual(res.wrappedKey, { v: wk.v, eph: wk.eph, nonce: wk.nonce, ct: wk.ct, tag: wk.tag });
  assert.equal(res.workspaceHasKey, true);

  // Another device of the same member: no key of its own, but the workspace has one.
  const second = await deps.login.register({
    memberId: onboard.memberId,
    workspaceId: onboard.workspaceId,
    publicKey: generateDeviceKeyPair().publicKey,
    role: "owner",
  });
  res = await readJson(await c("GET", `/v1/devices/${second.id}/wrapped-key`));
  assert.equal(res.wrappedKey, null);
  assert.equal(res.workspaceHasKey, true);
});

test("a member cannot read another member's device wrapped key", async () => {
  const deps: AppDeps = memoryDeps();
  const app = createApp(deps);
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  const otherMember = await deps.members.create({ workspaceId: ws.id, email: "x@acme.test", role: "member" });
  const otherDevice = await deps.login.register({
    memberId: otherMember.id, workspaceId: ws.id, publicKey: generateDeviceKeyPair().publicKey, role: "member",
  });
  const { token } = await deps.tokens.issue({
    deviceId: "d", memberId: "mem-self", scope: { workspaceId: ws.id, role: "member" },
  });
  const res = await client(app, token)("GET", `/v1/devices/${otherDevice.id}/wrapped-key`);
  assert.equal(res.status, 403);
});

test("a member cannot issue a wrapped key to another member's device", async () => {
  const deps: AppDeps = memoryDeps();
  const app = createApp(deps);
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  const otherMember = await deps.members.create({ workspaceId: ws.id, email: "x@acme.test", role: "member" });
  const otherDevice = await deps.login.register({
    memberId: otherMember.id, workspaceId: ws.id, publicKey: generateDeviceKeyPair().publicKey, role: "member",
  });
  const { token } = await deps.tokens.issue({
    deviceId: "d", memberId: "mem-self", scope: { workspaceId: ws.id, role: "member" },
  });
  const wk = wrapWorkspaceKey(generateWorkspaceKey(), generateDeviceKeyPair().publicKey);
  const res = await client(app, token)("PUT", `/v1/devices/${otherDevice.id}/wrapped-key`, {
    wrappedKey: { v: wk.v, eph: wk.eph, nonce: wk.nonce, ct: wk.ct, tag: wk.tag },
  });
  assert.equal(res.status, 403);
});
