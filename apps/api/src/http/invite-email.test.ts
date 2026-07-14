import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, type AppDeps } from "./app.js";
import { memoryDeps } from "../deps.js";
import { inviteEmail, ResendEmailSender, resendConfigFromEnv, type EmailMessage } from "../email/sender.js";

const readJson = (r: Response): Promise<any> => r.json();
const SALT = Buffer.from("0123456789abcdef").toString("base64");

function captureSender() {
  const sent: EmailMessage[] = [];
  return {
    sent,
    send: async (m: EmailMessage) => {
      sent.push(m);
      return "msg_1";
    },
  };
}

async function setup(sender: AppDeps["email"]) {
  const deps = memoryDeps();
  deps.email = sender;
  const app = createApp(deps);
  const ws = await deps.workspaces.create({ name: "Acme", kdfSalt: SALT });
  await deps.workspaces.update(ws.id, { plan: "team" });
  const inviter = await deps.members.create({ workspaceId: ws.id, email: "boss@acme.test", role: "owner" });
  const tok = (await deps.tokens.issue({
    deviceId: "d-a", memberId: inviter.id, scope: { workspaceId: ws.id, role: "owner" },
  })).token;
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { deps, ws, post };
}

test("inviting emails the join command; the response says so (#78)", async () => {
  const sender = captureSender();
  const { ws, post } = await setup(sender);

  const res = await readJson(await post(`/v1/workspaces/${ws.id}/members`, { email: "mate@acme.test", role: "member" }));
  assert.equal(res.emailSent, true);
  assert.equal(sender.sent.length, 1);
  const mail = sender.sent[0]!;
  assert.equal(mail.to, "mate@acme.test");
  assert.equal(mail.subject, "Join Acme on Keyline");
  assert.match(mail.text, new RegExp(`keyline join ${res.joinCode}`));
  assert.match(mail.text, /boss@acme.test invited you/);
  assert.match(mail.text, /expires in 7 days/);
});

test("no email provider: the invite still works, emailSent is false", async () => {
  const { ws, post } = await setup(null);
  const res = await post(`/v1/workspaces/${ws.id}/members`, { email: "mate@acme.test", role: "member" });
  assert.equal(res.status, 201);
  assert.equal((await readJson(res)).emailSent, false);
});

test("regenerating the join code re-sends the email with the fresh code", async () => {
  const sender = captureSender();
  const { ws, post } = await setup(sender);
  const invited = await readJson(await post(`/v1/workspaces/${ws.id}/members`, { email: "mate@acme.test", role: "member" }));

  const regen = await readJson(await post(`/v1/members/${invited.id}/join-code`, {}));
  assert.equal(regen.emailSent, true);
  assert.equal(sender.sent.length, 2);
  assert.match(sender.sent[1]!.text, new RegExp(`keyline join ${regen.joinCode}`));
});

test("a failing provider never blocks the invite", async () => {
  const { ws, post } = await setup({ send: async () => null });
  const res = await post(`/v1/workspaces/${ws.id}/members`, { email: "mate@acme.test", role: "member" });
  assert.equal(res.status, 201);
  assert.equal((await readJson(res)).emailSent, false);
});

test("ResendEmailSender posts the right payload and survives outages", async () => {
  const calls: Array<{ url: string; body: any }> = [];
  const okFetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ id: "re_123" }), { status: 200 });
  }) as unknown as typeof fetch;
  const sender = new ResendEmailSender({ apiKey: "re_key", from: "Keyline <invites@keyline.sh>" }, okFetch);
  assert.equal(await sender.send({ to: "x@y.z", subject: "s", text: "t" }), "re_123");
  assert.equal(calls[0]!.url, "https://api.resend.com/emails");
  assert.deepEqual(calls[0]!.body.to, ["x@y.z"]);
  assert.equal(calls[0]!.body.from, "Keyline <invites@keyline.sh>");

  const downFetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  const down = new ResendEmailSender({ apiKey: "k", from: "f" }, downFetch);
  assert.equal(await down.send({ to: "x@y.z", subject: "s", text: "t" }), null);
});

test("config resolution and the email copy", () => {
  assert.equal(resendConfigFromEnv({}), null);
  assert.equal(resendConfigFromEnv({ RESEND_API_KEY: "k" })?.from, "Keyline <invites@keyline.sh>");
  assert.equal(resendConfigFromEnv({ RESEND_API_KEY: "k", EMAIL_FROM: "X <a@b.c>" })?.from, "X <a@b.c>");

  const mail = inviteEmail({ workspaceName: "Acme", inviterEmail: null, joinCode: "AAAA-BBBB-CCCC" });
  assert.match(mail.text, /You were invited/);
  assert.ok(!mail.text.includes("—"), "no em-dash connectors (voice.md)");
});
