import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorkspaceKey, sealBundle, generateDeviceKeyPair, wrapWorkspaceKey } from "@keyline/crypto";
import { createApp, type AppDeps } from "./app.js";
import { memoryDeps } from "../deps.js";

const readJson = (r: Response): Promise<any> => r.json();
const SALT = Buffer.from("0123456789abcdef").toString("base64");

async function setup() {
  const deps: AppDeps = memoryDeps();
  const app = createApp(deps);
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  // Team plan: solo's 7-day retention window would hide the memory repo's
  // fixed-epoch timestamps (#49); these tests are about audit content.
  await deps.workspaces.update(ws.id, { plan: "team" });
  const project = await deps.projects.create({ workspaceId: ws.id, name: "API", slug: "api" });
  const env = await deps.environments.create({ projectId: project.id, name: "prod" });
  const adminTok = (await deps.tokens.issue({
    deviceId: "dev-a", memberId: "mem-a", scope: { workspaceId: ws.id, role: "admin" },
  })).token;

  const req = (method: string, path: string, t: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { authorization: `Bearer ${t}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  return { deps, app, ws, project, env, adminTok, req };
}

test("revoking a member drops their tokens and wrapped keys at once", async () => {
  const { deps, ws, env, adminTok, req } = await setup();

  // A member with a device, a live token, an env grant, and a wrapped key.
  const member = await deps.members.create({ workspaceId: ws.id, email: "m@acme.test", role: "member" });
  const device = await deps.login.register({
    memberId: member.id,
    workspaceId: ws.id,
    publicKey: generateDeviceKeyPair().publicKey,
    role: "member",
  });
  const memberTok = (await deps.tokens.issue({
    deviceId: device.id, memberId: member.id, scope: { workspaceId: ws.id, role: "member" },
  })).token;
  await deps.access.grant({ environmentId: env.id, memberId: member.id, role: "write" });
  const kp = generateDeviceKeyPair();
  const wk = wrapWorkspaceKey(generateWorkspaceKey(), kp.publicKey);
  await deps.wrappedKeys.upsert({
    workspaceId: ws.id, deviceId: device.id, formatVersion: wk.v, eph: wk.eph, nonce: wk.nonce, ct: wk.ct, tag: wk.tag,
  });

  // The member's token works before revoke.
  assert.ok(await deps.tokens.verify(memberTok));

  // Revoke.
  const res = await req("POST", `/v1/members/${member.id}/revoke`, adminTok);
  assert.equal(res.status, 200);
  const result = await readJson(res);
  assert.equal(result.tokensRevoked, 1);
  assert.equal(result.devicesRevoked, 1);
  assert.equal(result.wrappedKeysDeleted, 1);

  // Token no longer verifies; wrapped key gone; device marked revoked.
  assert.equal(await deps.tokens.verify(memberTok), null);
  assert.equal(await deps.wrappedKeys.findForDevice(ws.id, device.id), null);
  // register is idempotent on public key, so it returns the now-revoked device.
  const revokedDevice = await deps.login.register({
    memberId: member.id, workspaceId: ws.id, publicKey: device.publicKey, role: "member",
  });
  assert.ok(revokedDevice.revokedAt, "device is marked revoked");
});

test("revoke requires admin", async () => {
  const { deps, ws, req } = await setup();
  const member = await deps.members.create({ workspaceId: ws.id, email: "m@acme.test", role: "member" });
  const memberTok = (await deps.tokens.issue({
    deviceId: "d", memberId: member.id, scope: { workspaceId: ws.id, role: "member" },
  })).token;
  assert.equal((await req("POST", `/v1/members/${member.id}/revoke`, memberTok)).status, 403);
});

test("revoke is audited", async () => {
  const { deps, ws, adminTok, req } = await setup();
  const member = await deps.members.create({ workspaceId: ws.id, email: "m@acme.test", role: "member" });
  await req("POST", `/v1/members/${member.id}/revoke`, adminTok);
  const log = await readJson(await req("GET", `/v1/workspaces/${ws.id}/audit`, adminTok));
  assert.ok(log.events.some((e: any) => e.action === "member.revoke"));
});

test("rotating a secret produces a new bundle version and an audit event", async () => {
  const { ws, env, adminTok, req } = await setup();
  const seal = () => ({ bundle: sealBundle("API_KEY=v1", generateWorkspaceKey()) });

  // initial push -> v1
  assert.equal((await req("PUT", `/v1/environments/${env.id}/bundle`, adminTok, seal())).status, 201);

  // rotate -> v2 with the rotated secret named (value never sent server-side)
  const rot = await req("POST", `/v1/environments/${env.id}/rotate`, adminTok, {
    bundle: sealBundle("API_KEY=v2", generateWorkspaceKey()),
    baseVersion: 1,
    secretName: "API_KEY",
  });
  assert.equal(rot.status, 201);
  assert.equal((await readJson(rot)).version, 2);

  const log = await readJson(await req("GET", `/v1/workspaces/${ws.id}/audit`, adminTok));
  const rotate = log.events.find((e: any) => e.action === "secret.rotate");
  assert.ok(rotate);
  assert.equal(rotate.metadata.secretName, "API_KEY");
  assert.equal(rotate.metadata.version, 2);
});

test("rotate honors optimistic concurrency (stale base -> 409)", async () => {
  const { env, adminTok, req } = await setup();
  await req("PUT", `/v1/environments/${env.id}/bundle`, adminTok, { bundle: sealBundle("X=1", generateWorkspaceKey()) });
  const stale = await req("POST", `/v1/environments/${env.id}/rotate`, adminTok, {
    bundle: sealBundle("X=2", generateWorkspaceKey()),
    baseVersion: 0,
    secretName: "X",
  });
  assert.equal(stale.status, 409);
});
