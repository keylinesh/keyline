import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./app.js";
import { memoryDeps } from "../deps.js";
import { MagicLinkService, InMemoryMagicLinkRepo, MAGIC_LINK_TTL_MS } from "../domain/magic-links.js";
import type { EmailMessage } from "../email/sender.js";

const readJson = (r: Response): Promise<any> => r.json();
const SALT = Buffer.from("0123456789abcdef").toString("base64");

async function setup() {
  const deps = memoryDeps();
  const sent: EmailMessage[] = [];
  deps.magicLinks = new MagicLinkService(
    new InMemoryMagicLinkRepo(),
    deps.members,
    deps.devices,
    deps.workspaces,
    deps.tokens,
    { send: async (m) => (sent.push(m), "msg_1") },
    deps.audit,
    "https://keyline.sh/app",
  );
  const app = createApp(deps);
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  const member = await deps.members.create({ workspaceId: ws.id, email: "dev@acme.test", role: "member" });
  const device = await deps.login.register({
    memberId: member.id, workspaceId: ws.id, publicKey: "pk-dev", role: "member",
  });
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { deps, app, ws, member, device, sent, post };
}

function tokenFrom(sent: EmailMessage[]): string {
  const match = /#ml=([A-Za-z0-9_-]+)/.exec(sent[sent.length - 1]!.text);
  assert.ok(match, "email contains the link token");
  return match![1]!;
}

test("magic link: request -> email -> claim -> a working metadata session (#68)", async () => {
  const { deps, ws, member, device, sent, post } = await setup();

  const res = await post("/v1/web/magic", { email: "dev@acme.test" });
  assert.equal(res.status, 202);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.to, "dev@acme.test");
  assert.equal(sent[0]!.subject, "Sign in to Acme");

  const claim = await readJson(await post("/v1/web/magic/claim", { token: tokenFrom(sent) }));
  assert.equal(claim.workspaceId, ws.id);
  assert.equal(claim.memberId, member.id);
  assert.equal(claim.role, "member");

  // The minted token works on member routes and is bound to the real device.
  const app = createApp(deps);
  const me = await app.request(`/v1/workspaces/${ws.id}/members`, {
    headers: { authorization: `Bearer ${claim.token}` },
  });
  assert.equal(me.status, 200);
  const stored = await deps.tokens.verify(claim.token);
  assert.equal(stored?.deviceId, device.id);
});

test("requests never reveal whether an email exists, and links are one-time", async () => {
  const { sent, post } = await setup();

  const unknown = await post("/v1/web/magic", { email: "nobody@nowhere.test" });
  assert.equal(unknown.status, 202, "same response for unknown email");
  assert.equal(sent.length, 0, "nothing sent");

  await post("/v1/web/magic", { email: "dev@acme.test" });
  const token = tokenFrom(sent);
  assert.equal((await post("/v1/web/magic/claim", { token })).status, 200);
  assert.equal((await post("/v1/web/magic/claim", { token })).status, 404, "burned on use");
});

test("members without an active device get no link; revocation kills pending links", async () => {
  const { deps, ws, sent, post } = await setup();

  // Invited member, never joined: no device, no email.
  await deps.members.create({ workspaceId: ws.id, email: "invited@acme.test", role: "member" });
  await post("/v1/web/magic", { email: "invited@acme.test" });
  assert.equal(sent.length, 0);

  // Device revoked between request and claim: fail closed.
  await post("/v1/web/magic", { email: "dev@acme.test" });
  const token = tokenFrom(sent);
  const member = (await deps.members.findByEmailAnywhere("dev@acme.test"))[0]!;
  for (const d of await deps.devices.listByMember(member.id)) await deps.devices.revoke(d.id, new Date());
  assert.equal((await post("/v1/web/magic/claim", { token })).status, 404);
});

test("expired links are rejected", async () => {
  const { deps, sent, post } = await setup();
  await post("/v1/web/magic", { email: "dev@acme.test" });
  const token = tokenFrom(sent);

  // Simulate expiry by claiming through the service with a late clock.
  const claim = await deps.magicLinks.claim(token, new Date(Date.now() + MAGIC_LINK_TTL_MS + 1000));
  assert.equal(claim, null);
});

test("without an email provider, requests are still a quiet 202", async () => {
  const deps = memoryDeps();
  deps.magicLinks = new MagicLinkService(
    new InMemoryMagicLinkRepo(), deps.members, deps.devices, deps.workspaces, deps.tokens, null, deps.audit,
  );
  const app = createApp(deps);
  const res = await app.request("/v1/web/magic", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "dev@acme.test" }),
  });
  assert.equal(res.status, 202);
});
