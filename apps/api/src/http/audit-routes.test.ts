import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorkspaceKey, sealBundle } from "@keyline/crypto";
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

  return { deps, app, ws, env, adminTok, req };
}

test("a push records an allowed audit event and the chain verifies", async () => {
  const { ws, env, adminTok, req } = await setup();
  await req("PUT", `/v1/environments/${env.id}/bundle`, adminTok, {
    bundle: sealBundle("X=1", generateWorkspaceKey()),
  });

  const log = await readJson(await req("GET", `/v1/workspaces/${ws.id}/audit`, adminTok));
  const push = log.events.find((e: any) => e.action === "bundle.push");
  assert.ok(push, "bundle.push event recorded");
  assert.equal(push.outcome, "allowed");
  assert.equal(push.targetId, env.id);

  const verify = await readJson(await req("GET", `/v1/workspaces/${ws.id}/audit/verify`, adminTok));
  assert.equal(verify.ok, true);
  assert.ok(verify.count >= 1);
});

test("a denied push is recorded as outcome=denied", async () => {
  const { deps, ws, env, adminTok, req } = await setup();
  // A member with no env grant is denied.
  const memberTok = (await deps.tokens.issue({
    deviceId: "dev-m", memberId: "mem-m", scope: { workspaceId: ws.id, role: "member" },
  })).token;
  const res = await req("PUT", `/v1/environments/${env.id}/bundle`, memberTok, {
    bundle: sealBundle("X=1", generateWorkspaceKey()),
  });
  assert.equal(res.status, 403);

  const log = await readJson(await req("GET", `/v1/workspaces/${ws.id}/audit`, adminTok));
  const denied = log.events.find((e: any) => e.outcome === "denied");
  assert.ok(denied, "denied attempt recorded");
  assert.equal(denied.action, "bundle.push");
});

test("member invite and access grant are recorded", async () => {
  const { ws, env, adminTok, req } = await setup();
  const invite = await readJson(
    await req("POST", `/v1/workspaces/${ws.id}/members`, adminTok, { email: "x@acme.test", role: "member" }),
  );
  await req("PUT", `/v1/environments/${env.id}/access`, adminTok, { memberId: invite.id, role: "read" });

  const log = await readJson(await req("GET", `/v1/workspaces/${ws.id}/audit`, adminTok));
  const actions = log.events.map((e: any) => e.action);
  assert.ok(actions.includes("member.invite"));
  assert.ok(actions.includes("access.grant"));
});

test("audit log requires admin", async () => {
  const { deps, ws, req } = await setup();
  const memberTok = (await deps.tokens.issue({
    deviceId: "dev-m", memberId: "mem-m", scope: { workspaceId: ws.id, role: "member" },
  })).token;
  assert.equal((await req("GET", `/v1/workspaces/${ws.id}/audit`, memberTok)).status, 403);
});
