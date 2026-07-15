import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorkspaceKey, sealBundle } from "@keyline/crypto";
import { createApp, type AppDeps } from "./app.js";
import { memoryDeps } from "../deps.js";
import type { Role } from "../auth/scope.js";

const readJson = (r: Response): Promise<any> => r.json();
const SALT = Buffer.from("0123456789abcdef").toString("base64");

async function setup() {
  const deps: AppDeps = memoryDeps();
  const app = createApp(deps);
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  const project = await deps.projects.create({ workspaceId: ws.id, name: "API", slug: "api" });
  const env = await deps.environments.create({ projectId: project.id, name: "prod" });

  // mint a token for an arbitrary (memberId, role) within the workspace
  async function token(role: Role, memberId = "mem-admin", deviceId = "dev-1") {
    const { token } = await deps.tokens.issue({
      deviceId,
      memberId,
      scope: { workspaceId: ws.id, role },
    });
    return token;
  }
  const req = (method: string, path: string, t: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { authorization: `Bearer ${t}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  return { deps, app, ws, project, env, token, req };
}

test("admin can invite, list, and remove members", async () => {
  const { ws, token, req } = await setup();
  const admin = await token("admin");

  const invite = await req("POST", `/v1/workspaces/${ws.id}/members`, admin, {
    email: "dev@acme.test",
    role: "member",
  });
  assert.equal(invite.status, 201);
  const member = await readJson(invite);

  const list = await readJson(await req("GET", `/v1/workspaces/${ws.id}/members`, admin));
  assert.equal(list.members.length, 1);

  assert.equal((await req("DELETE", `/v1/members/${member.id}`, admin)).status, 204);
  assert.equal((await readJson(await req("GET", `/v1/workspaces/${ws.id}/members`, admin))).members.length, 0);
});

test("a plain member cannot invite (403) but can list", async () => {
  const { ws, token, req } = await setup();
  const member = await token("member");
  assert.equal(
    (await req("POST", `/v1/workspaces/${ws.id}/members`, member, { email: "x@y.z", role: "member" })).status,
    403,
  );
  assert.equal((await req("GET", `/v1/workspaces/${ws.id}/members`, member)).status, 200);
});

test("duplicate invite email is a conflict (409)", async () => {
  const { ws, token, req } = await setup();
  const admin = await token("admin");
  const body = { email: "dup@acme.test", role: "member" as const };
  assert.equal((await req("POST", `/v1/workspaces/${ws.id}/members`, admin, body)).status, 201);
  assert.equal((await req("POST", `/v1/workspaces/${ws.id}/members`, admin, body)).status, 409);
});

test("a plain member with no grant cannot read or write an environment", async () => {
  const { env, token, req } = await setup();
  const member = await token("member", "mem-42", "dev-42");
  const seal = () => ({ bundle: sealBundle("X=1", generateWorkspaceKey()) });
  assert.equal((await req("PUT", `/v1/environments/${env.id}/bundle`, member, seal())).status, 403);
  assert.equal((await req("GET", `/v1/environments/${env.id}/bundle`, member)).status, 403);
});

test("read grant allows pull but not push; write grant allows both", async () => {
  const { deps, ws, env, token, req } = await setup();
  const member = await deps.members.create({ workspaceId: ws.id, email: "m@acme.test", role: "member" });
  const memberTok = await token("member", member.id, "dev-m");
  const admin = await token("admin");
  const seal = () => ({ bundle: sealBundle("X=1", generateWorkspaceKey()) });

  // grant read
  assert.equal(
    (await req("PUT", `/v1/environments/${env.id}/access`, admin, { memberId: member.id, role: "read" })).status,
    200,
  );
  // need at least one bundle to pull; admin (implicit env-admin) pushes it
  assert.equal((await req("PUT", `/v1/environments/${env.id}/bundle`, admin, seal())).status, 201);

  // read can pull, cannot push
  assert.equal((await req("GET", `/v1/environments/${env.id}/bundle`, memberTok)).status, 200);
  assert.equal((await req("PUT", `/v1/environments/${env.id}/bundle`, memberTok, seal())).status, 403);

  // upgrade to write -> can push
  assert.equal(
    (await req("PUT", `/v1/environments/${env.id}/access`, admin, { memberId: member.id, role: "write" })).status,
    200,
  );
  assert.equal((await req("PUT", `/v1/environments/${env.id}/bundle`, memberTok, seal())).status, 201);
});

test("only an env admin can manage access; a plain member cannot grant", async () => {
  const { deps, ws, env, token, req } = await setup();
  const member = await deps.members.create({ workspaceId: ws.id, email: "m@acme.test", role: "member" });
  const memberTok = await token("member", member.id, "dev-m");
  assert.equal(
    (await req("PUT", `/v1/environments/${env.id}/access`, memberTok, { memberId: member.id, role: "read" })).status,
    403,
  );
});

test("granting access to a member outside the workspace is 404", async () => {
  const { env, token, req } = await setup();
  const admin = await token("admin");
  const res = await req("PUT", `/v1/environments/${env.id}/access`, admin, {
    memberId: "00000000-0000-0000-0000-000000000000",
    role: "read",
  });
  assert.equal(res.status, 404);
});

test("profile patch (#43): self and admin can set displayName; others cannot", async () => {
  const { deps, ws, token, req } = await setup();
  const dev = await deps.members.create({ workspaceId: ws.id, email: "dev@acme.test", role: "member" });
  const other = await deps.members.create({ workspaceId: ws.id, email: "other@acme.test", role: "member" });

  // self-edit
  const devTok = await token("member", dev.id, "dev-d");
  const res = await req("PATCH", `/v1/members/${dev.id}`, devTok, { displayName: "Dev Eloper" });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { displayName: string }).displayName, "Dev Eloper");

  // admin edits someone else; null clears
  const adminTok = await token("admin");
  const cleared = await req("PATCH", `/v1/members/${dev.id}`, adminTok, { displayName: null });
  assert.equal(((await cleared.json()) as { displayName: null }).displayName, null);

  // a plain member cannot edit another member
  assert.equal((await req("PATCH", `/v1/members/${other.id}`, devTok, { displayName: "x" })).status, 403);
});

test("overview returns the whole members page in one response (#41 perf)", async () => {
  const { deps, ws, env, token, req } = await setup();
  const admin = await token("admin");
  await deps.workspaces.update(ws.id, { plan: "team" }); // two invites; solo caps at one

  // An invited member (no device), and an active one with a granted env.
  const invited = await readJson(
    await req("POST", `/v1/workspaces/${ws.id}/members`, admin, { email: "new@acme.test", role: "member" }),
  );
  const active = await readJson(
    await req("POST", `/v1/workspaces/${ws.id}/members`, admin, { email: "dev@acme.test", role: "member" }),
  );
  await deps.login.register({ memberId: active.id, workspaceId: ws.id, publicKey: "pk-dev", role: "member" });
  assert.equal(
    (await req("PUT", `/v1/environments/${env.id}/access`, admin, { memberId: active.id, role: "write" })).status,
    200,
  );

  const res = await req("GET", `/v1/workspaces/${ws.id}/members/overview`, admin);
  assert.equal(res.status, 200);
  const overview = await readJson(res);

  assert.deepEqual(
    overview.environments.map((e: any) => e.label),
    ["api/prod"],
  );
  const byEmail = new Map(overview.members.map((m: any) => [m.email, m]));
  const inv = byEmail.get("new@acme.test") as any;
  assert.equal(inv.status, "invited");
  assert.deepEqual(inv.grants, []);
  const dev = byEmail.get("dev@acme.test") as any;
  assert.equal(dev.status, "active");
  assert.equal(dev.keyed, false, "no wrapped key issued yet");
  assert.deepEqual(dev.grants, [{ environmentId: env.id, role: "write" }]);

  // Admin-only, like the endpoints it aggregates.
  const plain = await token("member", "mem-plain");
  assert.equal((await req("GET", `/v1/workspaces/${ws.id}/members/overview`, plain)).status, 403);
});
