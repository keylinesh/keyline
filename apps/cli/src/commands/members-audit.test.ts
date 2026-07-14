import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateDeviceKeyPair, unwrapWorkspaceKey } from "@keyline/crypto";
import { ApiClient } from "../api-client.js";
import { loadAccount, saveAccount } from "../account.js";
import { loadCredentials, saveCredentials } from "../credentials.js";
import { harness, memStore, type Harness } from "../test-harness.js";
import { runPush } from "./push.js";
import { runPull } from "./pull.js";
import { runAudit, runAuditVerify } from "./audit.js";
import { runGrant, runInvite, runMembersList } from "./members.js";

const IDENTITY_ACCOUNT = "device-identity";

/** Invite an email and stand up a full CLI identity (store + device + login). */
async function joinAsMember(h: Harness, email: string) {
  await runInvite(h.deps, { email });
  const account = loadAccount(h.deps.store)!;
  const owner = new ApiClient({
    baseUrl: "",
    token: loadCredentials(h.deps.store)!.token,
    fetchImpl: h.fetchImpl,
  });
  const { members } = await owner.get<{ members: Array<{ id: string; email: string }> }>(
    `/v1/workspaces/${account.workspaceId}/members`,
  );
  const memberId = members.find((m) => m.email === email)!.id;

  const kp = generateDeviceKeyPair();
  const anon = new ApiClient({ baseUrl: "", fetchImpl: h.fetchImpl });
  const { joinCode } = await owner.post<{ joinCode: string }>(`/v1/members/${memberId}/join-code`, {});
  const device = await anon.post<{ deviceId: string }>("/v1/join", {
    code: joinCode,
    devicePublicKey: kp.publicKey,
  });
  const ch = await anon.post<{ challengeId: string; sealed: never }>(
    "/v1/auth/device/challenge",
    { deviceId: device.deviceId },
  );
  const login = await anon.post<{ token: string; expiresAt: string }>(
    "/v1/auth/device/login",
    {
      challengeId: ch.challengeId,
      answer: unwrapWorkspaceKey(ch.sealed, kp.privateKey).toString("base64"),
    },
  );

  const store = memStore();
  store.set(
    IDENTITY_ACCOUNT,
    JSON.stringify({ deviceId: "local", publicKey: kp.publicKey, privateKey: kp.privateKey }),
  );
  saveAccount({ deviceId: device.deviceId, workspaceId: account.workspaceId, email }, store);
  saveCredentials({ token: login.token, expiresAt: login.expiresAt }, store);
  return {
    memberId,
    deps: { store, apiBaseUrl: "", fetchImpl: h.fetchImpl, statePath: join(h.dir, `state-${email}.json`) },
  };
}

test("the full team flow: invite -> grant -> teammate pulls and decrypts", async () => {
  const h = await harness();
  try {
    await runPush(h.deps, { dir: h.dir });
    const teammate = await joinAsMember(h, "dev@acme.test");

    // Before the grant: no env role AND no wrapped key -> pull is refused.
    const theirDir = join(h.dir, "their-checkout");
    mkdirSync(theirDir);
    writeFileSync(
      join(theirDir, ".keyline.json"),
      readFileSync(join(h.dir, ".keyline.json")),
    );
    await assert.rejects(() => runPull(teammate.deps, { dir: theirDir }));

    const grant = await runGrant(h.deps, {
      dir: h.dir,
      email: "dev@acme.test",
      env: "prod",
      role: "read",
    });
    assert.equal(grant.keysIssued, 1, "workspace key wrapped to their device");
    assert.equal(grant.memberHasNoDevice, false);

    // After: they pull and get the exact plaintext. Nothing was re-encrypted.
    const pulled = await runPull(teammate.deps, { dir: theirDir });
    assert.equal(pulled.secretCount, 2);
    assert.equal(
      readFileSync(join(theirDir, ".env"), "utf8"),
      readFileSync(join(h.dir, ".env"), "utf8"),
    );

    // read !== write: their push is refused.
    await assert.rejects(
      () => runPush(teammate.deps, { dir: theirDir }),
      (err: Error) => /write|forbidden|409|requires/i.test(err.message),
    );
  } finally {
    h.cleanup();
  }
});

test("members list shows workspace roles and per-env roles with --env", async () => {
  const h = await harness();
  try {
    await runPush(h.deps, { dir: h.dir });
    await joinAsMember(h, "dev@acme.test");
    await runGrant(h.deps, { dir: h.dir, email: "dev@acme.test", env: "prod", role: "write" });

    const plain = await runMembersList(h.deps);
    assert.deepEqual(
      plain.members.map((m) => [m.email, m.role]).sort(),
      [["dev@acme.test", "member"], ["founder@acme.test", "owner"]],
    );

    const scoped = await runMembersList(h.deps, { dir: h.dir, env: "prod" });
    assert.equal(scoped.env, "prod");
    const dev = scoped.members.find((m) => m.email === "dev@acme.test")!;
    assert.equal(dev.envRole, "write");
    const founder = scoped.members.find((m) => m.email === "founder@acme.test")!;
    assert.equal(founder.envRole, null, "owner has implicit admin, no explicit grant");
  } finally {
    h.cleanup();
  }
});

test("grant: unknown member and unknown environment fail cleanly", async () => {
  const h = await harness();
  try {
    await runPush(h.deps, { dir: h.dir });
    await assert.rejects(
      () => runGrant(h.deps, { dir: h.dir, email: "ghost@acme.test", env: "prod", role: "read" }),
      /No member/,
    );
    await assert.rejects(
      () => runGrant(h.deps, { dir: h.dir, email: "founder@acme.test", env: "staging", role: "read" }),
      /No environment "staging".*prod/,
    );
  } finally {
    h.cleanup();
  }
});

test("grant to a member with no device grants the role and says so", async () => {
  const h = await harness();
  try {
    await runPush(h.deps, { dir: h.dir });
    await runInvite(h.deps, { email: "new@acme.test" });
    const grant = await runGrant(h.deps, {
      dir: h.dir,
      email: "new@acme.test",
      env: "prod",
      role: "read",
    });
    assert.equal(grant.keysIssued, 0);
    assert.equal(grant.memberHasNoDevice, true);
  } finally {
    h.cleanup();
  }
});

test("audit lists events with actor emails; --env filters; verify passes", async () => {
  const h = await harness();
  try {
    await runPush(h.deps, { dir: h.dir });
    await runPull(h.deps, { dir: h.dir });

    const all = await runAudit(h.deps);
    assert.ok(all.events.length >= 3, "onboard + push + pull at least");
    assert.ok(all.events.every((e) => e.actor === "founder@acme.test" || e.actor === "system"));
    assert.ok(all.events.some((e) => e.action === "bundle.push"));
    assert.ok(all.events.some((e) => e.action === "bundle.pull"));

    const scoped = await runAudit(h.deps, { dir: h.dir, env: "prod" });
    assert.equal(scoped.env, "prod");
    assert.ok(scoped.events.length >= 2);
    assert.ok(scoped.events.every((e) => e.target?.startsWith("environment:")));

    const limited = await runAudit(h.deps, { limit: 1 });
    assert.equal(limited.events.length, 1);
    assert.equal(limited.events[0]!.seq, all.events[all.events.length - 1]!.seq, "keeps the newest");
    assert.ok(limited.total > 1);

    const verify = await runAuditVerify(h.deps);
    assert.equal(verify.ok, true);
    assert.ok(verify.count! >= all.total);
  } finally {
    h.cleanup();
  }
});

test("audit --env rejects an unknown environment", async () => {
  const h = await harness();
  try {
    await assert.rejects(
      () => runAudit(h.deps, { dir: h.dir, env: "nope" }),
      /No environment "nope"/,
    );
  } finally {
    h.cleanup();
  }
});
