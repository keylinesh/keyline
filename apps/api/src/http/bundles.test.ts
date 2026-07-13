import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateWorkspaceKey,
  sealBundle,
  openBundle,
  generateDeviceKeyPair,
  wrapWorkspaceKey,
  unwrapWorkspaceKey,
} from "@keyline/crypto";
import { createApp, type AppDeps } from "./app.js";
import { memoryDeps } from "../deps.js";
import type { Role } from "../auth/scope.js";

const readJson = (r: Response): Promise<any> => r.json();
const SALT = Buffer.from("0123456789abcdef").toString("base64");

async function setup(opts: { role?: Role; environmentIds?: string[]; deviceId?: string } = {}) {
  const deps: AppDeps = memoryDeps();
  const app = createApp(deps);
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  const project = await deps.projects.create({ workspaceId: ws.id, name: "API", slug: "api" });
  const env = await deps.environments.create({ projectId: project.id, name: "prod" });
  const deviceId = opts.deviceId ?? "dev-1";
  // Grant the member write access on the env (RBAC from #23); push/pull need it.
  await deps.access.grant({ environmentId: env.id, memberId: "mem-1", role: "write" });
  const { token } = await deps.tokens.issue({
    deviceId,
    memberId: "mem-1",
    scope: { workspaceId: ws.id, role: opts.role ?? "member", environmentIds: opts.environmentIds },
  });

  const req = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  return { deps, app, ws, project, env, deviceId, req };
}

test("push then pull round-trips the ciphertext (server only stores ciphertext)", async () => {
  const { env, req } = await setup();
  const key = generateWorkspaceKey();
  const sealed = sealBundle("OPENAI_API_KEY=sk-proj-x\nDB_URL=postgres://h/db", key);

  const push = await req("PUT", `/v1/environments/${env.id}/bundle`, { bundle: sealed });
  assert.equal(push.status, 201);
  assert.equal((await readJson(push)).version, 1);

  const pull = await req("GET", `/v1/environments/${env.id}/bundle`);
  assert.equal(pull.status, 200);
  const body = await readJson(pull);
  // The returned bundle decrypts back to the original plaintext.
  const decrypted = openBundle(
    { v: body.bundle.v, nonce: body.bundle.nonce, ciphertext: body.bundle.ciphertext, tag: body.bundle.tag },
    key,
  );
  assert.match(decrypted.toString("utf8"), /OPENAI_API_KEY=sk-proj-x/);
});

test("pull returns this device's wrapped key (decryptable end to end)", async () => {
  const { deps, env, ws, deviceId, req } = await setup();
  await req("PUT", `/v1/environments/${env.id}/bundle`, { bundle: sealBundle("X=1", generateWorkspaceKey()) });

  // Grant the device a wrapped workspace key (normally done by membership/#23).
  const workspaceKey = generateWorkspaceKey();
  const device = generateDeviceKeyPair();
  const wk = wrapWorkspaceKey(workspaceKey, device.publicKey);
  await deps.wrappedKeys.upsert({
    workspaceId: ws.id, deviceId, formatVersion: wk.v, eph: wk.eph, nonce: wk.nonce, ct: wk.ct, tag: wk.tag,
  });

  const body = await readJson(await req("GET", `/v1/environments/${env.id}/bundle`));
  assert.ok(body.wrappedKey, "wrapped key should be present");
  const recovered = unwrapWorkspaceKey(
    { v: body.wrappedKey.v, eph: body.wrappedKey.eph, nonce: body.wrappedKey.nonce, ct: body.wrappedKey.ct, tag: body.wrappedKey.tag },
    device.privateKey,
  );
  assert.deepEqual(recovered, workspaceKey);
});

test("wrappedKey is null when the device has none", async () => {
  const { env, req } = await setup();
  await req("PUT", `/v1/environments/${env.id}/bundle`, { bundle: sealBundle("X=1", generateWorkspaceKey()) });
  const body = await readJson(await req("GET", `/v1/environments/${env.id}/bundle`));
  assert.equal(body.wrappedKey, null);
});

test("optimistic concurrency: stale baseVersion is a 409, fresh one succeeds", async () => {
  const { env, req } = await setup();
  const seal = () => sealBundle("X=1", generateWorkspaceKey());

  // First write at base 0 -> version 1.
  const first = await req("PUT", `/v1/environments/${env.id}/bundle`, { bundle: seal(), baseVersion: 0 });
  assert.equal((await readJson(first)).version, 1);

  // Stale base 0 again -> conflict, reports current version.
  const stale = await req("PUT", `/v1/environments/${env.id}/bundle`, { bundle: seal(), baseVersion: 0 });
  assert.equal(stale.status, 409);
  const conflict = await readJson(stale);
  assert.equal(conflict.error.code, "conflict");
  assert.equal(conflict.error.details.currentVersion, 1);

  // Correct base 1 -> version 2.
  const ok = await req("PUT", `/v1/environments/${env.id}/bundle`, { bundle: seal(), baseVersion: 1 });
  assert.equal((await readJson(ok)).version, 2);
});

test("pull on an empty environment is 404", async () => {
  const { env, req } = await setup();
  const res = await req("GET", `/v1/environments/${env.id}/bundle`);
  assert.equal(res.status, 404);
});

test("a token scoped to other environments cannot push (403)", async () => {
  const { env, req } = await setup({ environmentIds: ["00000000-0000-0000-0000-000000000000"] });
  const res = await req("PUT", `/v1/environments/${env.id}/bundle`, { bundle: sealBundle("X=1", generateWorkspaceKey()) });
  assert.equal(res.status, 403);
});

test("invalid bundle body is a 422", async () => {
  const { env, req } = await setup();
  const res = await req("PUT", `/v1/environments/${env.id}/bundle`, { bundle: { v: 0, nonce: "", ciphertext: "", tag: "" } });
  assert.equal(res.status, 422);
});
