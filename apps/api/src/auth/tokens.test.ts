import { test } from "node:test";
import assert from "node:assert/strict";
import { TokenService, hashToken } from "./tokens.js";
import { InMemoryTokenRepo } from "./memory-repo.js";

const scope = { workspaceId: "ws1", role: "member" as const };
const principalInput = { deviceId: "dev1", memberId: "mem1", scope };

test("issues a token that verifies to its principal", async () => {
  const svc = new TokenService(new InMemoryTokenRepo());
  const { token } = await svc.issue(principalInput);
  const principal = await svc.verify(token);
  assert.equal(principal?.deviceId, "dev1");
  assert.equal(principal?.memberId, "mem1");
  assert.equal(principal?.scope.workspaceId, "ws1");
  assert.equal(principal?.scope.role, "member");
});

test("stores only the hash, never the token", async () => {
  const repo = new InMemoryTokenRepo();
  const svc = new TokenService(repo);
  const { token } = await svc.issue(principalInput);
  const stored = await repo.findByHash(hashToken(token));
  assert.ok(stored);
  assert.equal(stored.tokenHash, hashToken(token));
  assert.notEqual(stored.tokenHash, token);
});

test("an unknown token does not verify", async () => {
  const svc = new TokenService(new InMemoryTokenRepo());
  assert.equal(await svc.verify("klk_nonexistent"), null);
});

test("an expired token does not verify", async () => {
  const svc = new TokenService(new InMemoryTokenRepo());
  const t0 = new Date("2026-01-01T00:00:00Z");
  const { token } = await svc.issue({ ...principalInput, ttlMs: 1000, now: t0 });
  const after = new Date(t0.getTime() + 2000);
  assert.equal(await svc.verify(token, after), null);
});

test("a revoked token does not verify", async () => {
  const svc = new TokenService(new InMemoryTokenRepo());
  const { token } = await svc.issue(principalInput);
  await svc.revoke(token);
  assert.equal(await svc.verify(token), null);
});

test("revokeDevice revokes every active token for that device", async () => {
  const svc = new TokenService(new InMemoryTokenRepo());
  const a = await svc.issue(principalInput);
  const b = await svc.issue(principalInput);
  const other = await svc.issue({ ...principalInput, deviceId: "dev2" });

  const n = await svc.revokeDevice("dev1");
  assert.equal(n, 2);
  assert.equal(await svc.verify(a.token), null);
  assert.equal(await svc.verify(b.token), null);
  assert.ok(await svc.verify(other.token)); // dev2 untouched
});

test("carries environment scoping through verification", async () => {
  const svc = new TokenService(new InMemoryTokenRepo());
  const { token } = await svc.issue({
    ...principalInput,
    scope: { workspaceId: "ws1", role: "member", environmentIds: ["env-a"] },
  });
  const p = await svc.verify(token);
  assert.deepEqual(p?.scope.environmentIds, ["env-a"]);
});
