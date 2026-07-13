import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, type AppDeps } from "./app.js";
import { memoryDeps } from "../deps.js";
import type { WorkspacePlan } from "../domain/resources.js";

const readJson = (r: Response): Promise<any> => r.json();
const SALT = Buffer.from("0123456789abcdef").toString("base64");

async function setup(plan: WorkspacePlan = "solo") {
  const deps: AppDeps = memoryDeps();
  const app = createApp(deps);
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  if (plan !== "solo") await deps.workspaces.update(ws.id, { plan });
  const project = await deps.projects.create({ workspaceId: ws.id, name: "API", slug: "api" });
  const adminTok = (await deps.tokens.issue({
    deviceId: "dev-a", memberId: "mem-a", scope: { workspaceId: ws.id, role: "admin" },
  })).token;

  const req = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { authorization: `Bearer ${adminTok}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  return { deps, app, ws, project, req };
}

test("new workspaces start on the solo plan and expose it in the API", async () => {
  const { ws, req } = await setup();
  const body = await readJson(await req("GET", `/v1/workspaces/${ws.id}`));
  assert.equal(body.plan, "solo");
});

test("solo allows one member; the second invite is a 402 plan_limit", async () => {
  const { ws, req } = await setup("solo");
  const first = await req("POST", `/v1/workspaces/${ws.id}/members`, {
    email: "a@acme.test", role: "member",
  });
  assert.equal(first.status, 201);

  const second = await req("POST", `/v1/workspaces/${ws.id}/members`, {
    email: "b@acme.test", role: "member",
  });
  assert.equal(second.status, 402);
  const err = (await readJson(second)).error;
  assert.equal(err.code, "plan_limit");
  assert.deepEqual(err.details, { plan: "solo", limit: 1, current: 1 });
});

test("team allows up to 10 members and blocks the 11th", async () => {
  const { ws, req } = await setup("team");
  for (let i = 0; i < 10; i++) {
    const res = await req("POST", `/v1/workspaces/${ws.id}/members`, {
      email: `m${i}@acme.test`, role: "member",
    });
    assert.equal(res.status, 201, `invite ${i + 1} allowed`);
  }
  const eleventh = await req("POST", `/v1/workspaces/${ws.id}/members`, {
    email: "m10@acme.test", role: "member",
  });
  assert.equal(eleventh.status, 402);
  assert.equal((await readJson(eleventh)).error.code, "plan_limit");
});

test("solo caps environments at 2 across the whole workspace", async () => {
  const { ws, project, req } = await setup("solo");
  assert.equal((await req("POST", `/v1/projects/${project.id}/environments`, { name: "dev" })).status, 201);
  assert.equal((await req("POST", `/v1/projects/${project.id}/environments`, { name: "prod" })).status, 201);

  // The cap is per workspace, not per project: a third env in a second project is blocked too.
  const other = await readJson(
    await req("POST", `/v1/workspaces/${ws.id}/projects`, { name: "Web", slug: "web" }),
  );
  const third = await req("POST", `/v1/projects/${other.id}/environments`, { name: "dev" });
  assert.equal(third.status, 402);
  const err = (await readJson(third)).error;
  assert.equal(err.code, "plan_limit");
  assert.deepEqual(err.details, { plan: "solo", limit: 2, current: 2 });
});

test("team environments are unlimited", async () => {
  const { project, req } = await setup("team");
  for (const name of ["dev", "staging", "prod", "preview"]) {
    assert.equal((await req("POST", `/v1/projects/${project.id}/environments`, { name })).status, 201);
  }
});

test("solo audit history is windowed to 7 days; verify still walks the full chain", async () => {
  const { deps, ws, req } = await setup("solo");
  // Memory-repo events are stamped at a fixed 2026-01-01 epoch — far outside
  // any real-time 7-day window, so solo must hide them but still verify them.
  await deps.audit.record({ workspaceId: ws.id, action: "member.invite", outcome: "allowed" });
  await deps.audit.record({ workspaceId: ws.id, action: "bundle.push", outcome: "allowed" });

  const log = await readJson(await req("GET", `/v1/workspaces/${ws.id}/audit`));
  assert.equal(log.retentionDays, 7);
  assert.deepEqual(log.events, []);

  const verify = await readJson(await req("GET", `/v1/workspaces/${ws.id}/audit/verify`));
  assert.equal(verify.ok, true);
  assert.equal(verify.count, 2);
});

test("team audit history is unlimited", async () => {
  const { deps, ws, req } = await setup("team");
  await deps.audit.record({ workspaceId: ws.id, action: "bundle.push", outcome: "allowed" });

  const log = await readJson(await req("GET", `/v1/workspaces/${ws.id}/audit`));
  assert.equal(log.retentionDays, null);
  assert.equal(log.events.length, 1);
});

test("auditWindowStart is now minus 7 days on solo, null on team", async () => {
  const { deps, ws } = await setup("solo");
  const now = new Date("2026-07-12T12:00:00Z");
  const since = await deps.entitlements.auditWindowStart(ws.id, now);
  assert.equal(since?.toISOString(), "2026-07-05T12:00:00.000Z");

  await deps.workspaces.update(ws.id, { plan: "team" });
  assert.equal(await deps.entitlements.auditWindowStart(ws.id, now), null);
});
