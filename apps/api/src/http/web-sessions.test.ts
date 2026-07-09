import { test } from "node:test";
import assert from "node:assert/strict";
import { generateDeviceKeyPair, unwrapWorkspaceKey } from "@keyline/crypto";
import { createApp, type AppDeps } from "./app.js";
import { memoryDeps } from "../deps.js";
import { normalizeSessionCode } from "../domain/web-sessions.js";

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

/** Onboard + device login; returns an authed client and ids. */
async function loggedInOwner(app: ReturnType<typeof createApp>) {
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
  const { token } = await readJson(
    await client(app)("POST", "/v1/auth/device/login", {
      challengeId: ch.challengeId,
      answer: unwrapWorkspaceKey(ch.sealed, device.privateKey).toString("base64"),
    }),
  );
  return { c: client(app, token), onboard };
}

test("web session: start -> CLI approve -> claim releases a working token once", async () => {
  const deps: AppDeps = memoryDeps();
  const app = createApp(deps);
  const { c, onboard } = await loggedInOwner(app);

  // Browser starts a session and shows the code.
  const start = await readJson(await client(app)("POST", "/v1/web/sessions"));
  assert.ok(start.sessionId && start.code && start.expiresAt);
  assert.match(start.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  // Still pending before approval.
  let poll = await readJson(await client(app)("POST", `/v1/web/sessions/${start.sessionId}/claim`));
  assert.equal(poll.status, "pending");

  // The CLI approves (code normalization: lowercase + spaces still match).
  const messy = start.code.toLowerCase().replace("-", " ");
  assert.equal((await c("POST", "/v1/web/sessions/approve", { code: messy })).status, 204);

  // First claim gets the token; it works against a protected route.
  poll = await readJson(await client(app)("POST", `/v1/web/sessions/${start.sessionId}/claim`));
  assert.equal(poll.status, "ready");
  assert.equal(poll.workspaceId, onboard.workspaceId);
  const web = client(app, poll.token);
  const ws = await readJson(await web("GET", `/v1/workspaces/${onboard.workspaceId}`));
  assert.equal(ws.id, onboard.workspaceId);

  // Second claim: consumed, no token.
  const again = await readJson(await client(app)("POST", `/v1/web/sessions/${start.sessionId}/claim`));
  assert.equal(again.status, "consumed");
  assert.equal(again.token, undefined);

  // Approval landed in the audit log.
  const { events } = await readJson(await c("GET", `/v1/workspaces/${onboard.workspaceId}/audit`));
  assert.ok(events.some((e: { action: string }) => e.action === "web.session.approve"));
});

test("web session: approving an unknown or reused code 404s", async () => {
  const deps: AppDeps = memoryDeps();
  const app = createApp(deps);
  const { c } = await loggedInOwner(app);

  assert.equal((await c("POST", "/v1/web/sessions/approve", { code: "XXXX-XXXX" })).status, 404);

  const start = await readJson(await client(app)("POST", "/v1/web/sessions"));
  assert.equal((await c("POST", "/v1/web/sessions/approve", { code: start.code })).status, 204);
  // Same code again: session is no longer pending.
  assert.equal((await c("POST", "/v1/web/sessions/approve", { code: start.code })).status, 404);
});

test("web session: approve requires authentication; claim of unknown id 404s", async () => {
  const app = createApp(memoryDeps());
  assert.equal(
    (await client(app)("POST", "/v1/web/sessions/approve", { code: "AAAA-BBBB" })).status,
    401,
  );
  assert.equal(
    (await client(app)("POST", "/v1/web/sessions/00000000-0000-0000-0000-000000000000/claim")).status,
    404,
  );
});

test("revoking the member kills the web session token too", async () => {
  const deps: AppDeps = memoryDeps();
  const app = createApp(deps);
  const { c, onboard } = await loggedInOwner(app);

  // Second member joins and opens a web session via their own device.
  const member = await deps.members.create({
    workspaceId: onboard.workspaceId,
    email: "dev@acme.test",
    role: "member",
  });
  const kp = generateDeviceKeyPair();
  const device = await deps.login.register({
    memberId: member.id,
    workspaceId: onboard.workspaceId,
    publicKey: kp.publicKey,
    role: "member",
  });
  const ch = await readJson(
    await client(app)("POST", "/v1/auth/device/challenge", { deviceId: device.id }),
  );
  const { token: cliToken } = await readJson(
    await client(app)("POST", "/v1/auth/device/login", {
      challengeId: ch.challengeId,
      answer: unwrapWorkspaceKey(ch.sealed, kp.privateKey).toString("base64"),
    }),
  );

  const start = await readJson(await client(app)("POST", "/v1/web/sessions"));
  await client(app, cliToken)("POST", "/v1/web/sessions/approve", { code: start.code });
  const poll = await readJson(await client(app)("POST", `/v1/web/sessions/${start.sessionId}/claim`));
  assert.equal(poll.status, "ready");
  const web = client(app, poll.token);
  assert.equal((await web("GET", `/v1/workspaces/${onboard.workspaceId}/members`)).status, 200);

  // Owner revokes the member: web token dies with the rest.
  await c("POST", `/v1/members/${member.id}/revoke`);
  assert.equal((await web("GET", `/v1/workspaces/${onboard.workspaceId}/members`)).status, 401);
});

test("code normalization strips separators and case", () => {
  assert.equal(normalizeSessionCode("lzq4-7nhk"), "LZQ47NHK");
  assert.equal(normalizeSessionCode(" LZQ4 7NHK "), "LZQ47NHK");
});
