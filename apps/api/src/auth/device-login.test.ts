import { test } from "node:test";
import assert from "node:assert/strict";
import { generateDeviceKeyPair, unwrapWorkspaceKey } from "@keyline/crypto";
import { DeviceLoginService, AuthError, CHALLENGE_TTL_MS } from "./device-login.js";
import { TokenService } from "./tokens.js";
import {
  InMemoryDeviceRepo,
  InMemoryChallengeRepo,
  InMemoryTokenRepo,
} from "./memory-repo.js";

function makeService() {
  const devices = new InMemoryDeviceRepo();
  const challenges = new InMemoryChallengeRepo();
  const tokens = new TokenService(new InMemoryTokenRepo());
  const login = new DeviceLoginService(devices, challenges, tokens);
  return { devices, challenges, tokens, login };
}

/** Simulate the device side: unseal the challenge with the private key. */
function answer(sealed: Parameters<typeof unwrapWorkspaceKey>[0], privateKey: string): string {
  return unwrapWorkspaceKey(sealed, privateKey).toString("base64");
}

test("registers a public key and is idempotent on it", async () => {
  const { login } = makeService();
  const kp = generateDeviceKeyPair();
  const input = { memberId: "m1", workspaceId: "w1", publicKey: kp.publicKey, role: "admin" as const };
  const first = await login.register(input);
  const second = await login.register(input);
  assert.equal(first.id, second.id);
});

test("end-to-end: a device proves possession and gets a working token", async () => {
  const { login, tokens } = makeService();
  const kp = generateDeviceKeyPair();
  const device = await login.register({
    memberId: "m1",
    workspaceId: "w1",
    publicKey: kp.publicKey,
    role: "member",
  });

  const { challengeId, sealed } = await login.beginChallenge(device.id);
  const { token } = await login.completeLogin({
    challengeId,
    answer: answer(sealed, kp.privateKey),
  });

  const principal = await tokens.verify(token);
  assert.equal(principal?.deviceId, device.id);
  assert.equal(principal?.scope.workspaceId, "w1");
  assert.equal(principal?.scope.role, "member");
});

test("a wrong answer is rejected", async () => {
  const { login } = makeService();
  const kp = generateDeviceKeyPair();
  const device = await login.register({
    memberId: "m1",
    workspaceId: "w1",
    publicKey: kp.publicKey,
    role: "member",
  });
  const { challengeId } = await login.beginChallenge(device.id);
  // A well-formed but incorrect 32-byte answer must be rejected by the service.
  // (An impostor can't even produce one: unwrapping the sealed challenge with
  // the wrong private key fails closed at the crypto layer.)
  const wrong = Buffer.alloc(32, 0).toString("base64");
  await assert.rejects(() => login.completeLogin({ challengeId, answer: wrong }), AuthError);
});

test("a challenge cannot be replayed", async () => {
  const { login } = makeService();
  const kp = generateDeviceKeyPair();
  const device = await login.register({
    memberId: "m1",
    workspaceId: "w1",
    publicKey: kp.publicKey,
    role: "member",
  });
  const { challengeId, sealed } = await login.beginChallenge(device.id);
  const ans = answer(sealed, kp.privateKey);
  await login.completeLogin({ challengeId, answer: ans });
  await assert.rejects(() => login.completeLogin({ challengeId, answer: ans }), AuthError);
});

test("an expired challenge is rejected", async () => {
  const { login } = makeService();
  const kp = generateDeviceKeyPair();
  const t0 = new Date("2026-01-01T00:00:00Z");
  const device = await login.register({
    memberId: "m1",
    workspaceId: "w1",
    publicKey: kp.publicKey,
    role: "member",
  });
  const { challengeId, sealed } = await login.beginChallenge(device.id, t0);
  const later = new Date(t0.getTime() + CHALLENGE_TTL_MS + 1);
  await assert.rejects(
    () => login.completeLogin({ challengeId, answer: answer(sealed, kp.privateKey) }, later),
    AuthError,
  );
});

test("a revoked device cannot begin a challenge", async () => {
  const { login, devices } = makeService();
  const kp = generateDeviceKeyPair();
  const device = await login.register({
    memberId: "m1",
    workspaceId: "w1",
    publicKey: kp.publicKey,
    role: "member",
  });
  await devices.revoke(device.id, new Date());
  await assert.rejects(() => login.beginChallenge(device.id), AuthError);
});
