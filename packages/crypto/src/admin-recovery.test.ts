import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorkspaceKey } from "./bundle.js";
import { generateDeviceKeyPair } from "./keypair.js";
import { wrapWorkspaceKey, unwrapWorkspaceKey } from "./envelope.js";
import {
  selectRecoveryAdmin,
  recoverToNewDevice,
  NoAdminDeviceAvailableError,
  AdminRecoveryError,
} from "./admin-recovery.js";

test("end-to-end: admin restores a member's lost device", () => {
  // Workspace exists; an admin device and a member both hold wrapped copies.
  const workspaceKey = generateWorkspaceKey();
  const admin = generateDeviceKeyPair();
  const adminWrappedKey = wrapWorkspaceKey(workspaceKey, admin.publicKey);

  // The member loses their device and provisions a new one.
  const newDevice = generateDeviceKeyPair();

  // 1. Pick an active admin device.
  const chosen = selectRecoveryAdmin([
    { deviceId: "admin-1", active: true },
    { deviceId: "old-laptop", active: false },
  ]);
  assert.equal(chosen.deviceId, "admin-1");

  // 2. The admin re-wraps the workspace key to the new device.
  const newWrap = recoverToNewDevice({
    adminWrappedKey,
    adminPrivateKey: admin.privateKey,
    newDevicePublicKey: newDevice.publicKey,
  });

  // 3. The member's new device can now unwrap the original workspace key.
  assert.deepEqual(unwrapWorkspaceKey(newWrap, newDevice.privateKey), workspaceKey);
});

test("clear failure when no active admin device is available", () => {
  assert.throws(() => selectRecoveryAdmin([]), NoAdminDeviceAvailableError);
  assert.throws(
    () => selectRecoveryAdmin([{ deviceId: "revoked", active: false }]),
    (err: Error) => {
      assert.ok(err instanceof NoAdminDeviceAvailableError);
      assert.match(err.message, /no active admin device/);
      return true;
    },
  );
});

test("recovery fails clearly when the admin device lacks access", () => {
  const workspaceKey = generateWorkspaceKey();
  const realAdmin = generateDeviceKeyPair();
  const impostor = generateDeviceKeyPair();
  const newDevice = generateDeviceKeyPair();

  // Wrap is for the real admin; the impostor's key cannot unwrap it.
  const adminWrappedKey = wrapWorkspaceKey(workspaceKey, realAdmin.publicKey);

  assert.throws(
    () =>
      recoverToNewDevice({
        adminWrappedKey,
        adminPrivateKey: impostor.privateKey,
        newDevicePublicKey: newDevice.publicKey,
      }),
    (err: Error) => {
      assert.ok(err instanceof AdminRecoveryError);
      assert.match(err.message, /could not unwrap/);
      return true;
    },
  );
});
