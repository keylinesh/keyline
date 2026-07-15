import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, type AppDeps } from "./app.js";
import { memoryDeps } from "../deps.js";
import type { Role } from "../auth/scope.js";

/** Read a response body as JSON without fighting the `unknown` return type. */
const readJson = (r: Response): Promise<any> => r.json();

/** Build an app plus a helper that mints a bearer token for a given scope. */
function setup() {
  const deps: AppDeps = memoryDeps();
  const app = createApp(deps);

  async function tokenFor(workspaceId: string, role: Role = "admin") {
    const { token } = await deps.tokens.issue({
      deviceId: "dev-1",
      memberId: "mem-1",
      scope: { workspaceId, role },
    });
    return token;
  }

  const req = (
    method: string,
    path: string,
    opts: { token?: string; body?: unknown } = {},
  ) =>
    app.request(path, {
      method,
      headers: {
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.body ? { "content-type": "application/json" } : {}),
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });

  return { deps, app, tokenFor, req };
}

const SALT = Buffer.from("0123456789abcdef").toString("base64");

test("health is public", async () => {
  const { req } = setup();
  const res = await req("GET", "/health");
  assert.equal(res.status, 200);
});

test("rejects requests without a token (401)", async () => {
  const { req } = setup();
  const res = await req("GET", "/v1/workspaces");
  assert.equal(res.status, 401);
  const body = await readJson(res);
  assert.equal(body.error.code, "unauthorized");
});

test("full workspace → project → environment CRUD happy path", async () => {
  const { deps, req, tokenFor } = setup();
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  const token = await tokenFor(ws.id, "admin");

  // create project
  let res = await req("POST", `/v1/workspaces/${ws.id}/projects`, {
    token,
    body: { name: "API", slug: "api" },
  });
  assert.equal(res.status, 201);
  const project = await readJson(res);
  assert.equal(project.workspaceId, ws.id);

  // create environment
  res = await req("POST", `/v1/projects/${project.id}/environments`, {
    token,
    body: { name: "prod" },
  });
  assert.equal(res.status, 201);
  const env = await readJson(res);

  // list environments
  res = await req("GET", `/v1/projects/${project.id}/environments`, { token });
  assert.equal((await readJson(res)).environments.length, 1);

  // the projects list embeds each project's environments (one-request pages)
  res = await req("GET", `/v1/workspaces/${ws.id}/projects`, { token });
  const listed = await readJson(res);
  assert.equal(listed.projects[0].environments.length, 1);
  assert.equal(listed.projects[0].environments[0].name, "prod");

  // update + delete environment
  res = await req("PATCH", `/v1/environments/${env.id}`, { token, body: { name: "production" } });
  assert.equal((await readJson(res)).name, "production");
  res = await req("DELETE", `/v1/environments/${env.id}`, { token });
  assert.equal(res.status, 204);
});

test("cross-workspace access is forbidden (403)", async () => {
  const { deps, req, tokenFor } = setup();
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  const other = await deps.workspaces.create({ name: "Other", kdfSalt: SALT });
  const tokenForOther = await tokenFor(other.id, "admin");

  const res = await req("GET", `/v1/workspaces/${ws.id}`, { token: tokenForOther });
  assert.equal(res.status, 403);
  assert.equal((await readJson(res)).error.code, "forbidden");
});

test("member role cannot create projects (403)", async () => {
  const { deps, req, tokenFor } = setup();
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  const token = await tokenFor(ws.id, "member");

  const res = await req("POST", `/v1/workspaces/${ws.id}/projects`, {
    token,
    body: { name: "API", slug: "api" },
  });
  assert.equal(res.status, 403);
});

test("only an owner can delete a workspace", async () => {
  const { deps, req, tokenFor } = setup();
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });

  const adminRes = await req("DELETE", `/v1/workspaces/${ws.id}`, { token: await tokenFor(ws.id, "admin") });
  assert.equal(adminRes.status, 403);

  const ownerRes = await req("DELETE", `/v1/workspaces/${ws.id}`, { token: await tokenFor(ws.id, "owner") });
  assert.equal(ownerRes.status, 204);
});

test("invalid input returns a validation_error (422) with details", async () => {
  const { deps, req, tokenFor } = setup();
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  const token = await tokenFor(ws.id, "admin");

  const res = await req("POST", `/v1/workspaces/${ws.id}/projects`, {
    token,
    body: { name: "", slug: "Not A Slug" },
  });
  assert.equal(res.status, 422);
  const body = await readJson(res);
  assert.equal(body.error.code, "validation_error");
  assert.ok(Array.isArray(body.error.details));
});

test("duplicate project slug is a conflict (409)", async () => {
  const { deps, req, tokenFor } = setup();
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  const token = await tokenFor(ws.id, "admin");
  const body = { name: "API", slug: "api" };

  assert.equal((await req("POST", `/v1/workspaces/${ws.id}/projects`, { token, body })).status, 201);
  const dup = await req("POST", `/v1/workspaces/${ws.id}/projects`, { token, body });
  assert.equal(dup.status, 409);
});

test("unknown project returns 404", async () => {
  const { deps, req, tokenFor } = setup();
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  const token = await tokenFor(ws.id, "admin");
  const res = await req("GET", `/v1/projects/00000000-0000-0000-0000-000000000000`, { token });
  assert.equal(res.status, 404);
});
