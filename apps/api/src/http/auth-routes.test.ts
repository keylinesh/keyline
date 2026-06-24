import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generateDeviceKeyPair, unwrapWorkspaceKey, type WrappedKey } from "@keyline/crypto";
import { createApp } from "./app.js";
import { memoryDeps } from "../deps.js";

/** Read a response body as JSON without fighting the `unknown` return type. */
const readJson = (r: Response): Promise<any> => r.json();

test("device register → challenge → login issues a usable token over HTTP", async () => {
  const app = createApp(memoryDeps());
  const kp = generateDeviceKeyPair();
  const memberId = randomUUID();
  const workspaceId = randomUUID();

  const json = (method: string, path: string, body: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  // register
  let res = await json("POST", "/v1/devices", {
    memberId,
    workspaceId,
    publicKey: kp.publicKey,
    role: "admin",
  });
  assert.equal(res.status, 201);
  const { deviceId } = await readJson(res);

  // challenge
  res = await json("POST", "/v1/auth/device/challenge", { deviceId });
  assert.equal(res.status, 200);
  const { challengeId, sealed } = (await readJson(res)) as { challengeId: string; sealed: WrappedKey };

  // unseal with the device private key (the proof of possession)
  const answer = unwrapWorkspaceKey(sealed, kp.privateKey).toString("base64");

  // login
  res = await json("POST", "/v1/auth/device/login", { challengeId, answer });
  assert.equal(res.status, 200);
  const { token } = await readJson(res);
  assert.ok(typeof token === "string" && token.startsWith("klk_"));

  // token works on a protected route
  res = await app.request("/v1/workspaces", {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
});

test("a bad challenge answer is rejected (401)", async () => {
  const app = createApp(memoryDeps());
  const kp = generateDeviceKeyPair();
  const json = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const reg = await readJson(
    await json("/v1/devices", {
      memberId: randomUUID(),
      workspaceId: randomUUID(),
      publicKey: kp.publicKey,
      role: "member",
    }),
  );
  const { challengeId } = await readJson(await json("/v1/auth/device/challenge", { deviceId: reg.deviceId }));

  const res = await json("/v1/auth/device/login", {
    challengeId,
    answer: Buffer.alloc(32, 0).toString("base64"),
  });
  assert.equal(res.status, 401);
});
