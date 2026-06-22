import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileKeyStore, openKeyStore } from "./keystore.js";

function tmpStore(): { store: FileKeyStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "keyline-keystore-"));
  return { store: new FileKeyStore(join(dir, "keys")), dir };
}

test("round-trips a secret", () => {
  const { store, dir } = tmpStore();
  try {
    assert.equal(store.get("device-identity"), null);
    store.set("device-identity", "the-secret");
    assert.equal(store.get("device-identity"), "the-secret");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("overwrites an existing secret", () => {
  const { store, dir } = tmpStore();
  try {
    store.set("acct", "one");
    store.set("acct", "two");
    assert.equal(store.get("acct"), "two");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("delete removes the secret and is a no-op when absent", () => {
  const { store, dir } = tmpStore();
  try {
    store.set("acct", "v");
    store.delete("acct");
    assert.equal(store.get("acct"), null);
    store.delete("acct"); // no throw
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writes the key file 0600 in a 0700 directory", () => {
  const { store, dir } = tmpStore();
  try {
    store.set("acct", "v");
    const keysDir = join(dir, "keys");
    assert.equal(statSync(keysDir).mode & 0o777, 0o700);
    assert.equal(statSync(join(keysDir, "acct.key")).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects account names that could escape the key directory", () => {
  const { store, dir } = tmpStore();
  try {
    assert.throws(() => store.set("../escape", "v"));
    assert.throws(() => store.get("a/b"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("openKeyStore honors KEYLINE_KEYSTORE=file", () => {
  const prev = process.env.KEYLINE_KEYSTORE;
  process.env.KEYLINE_KEYSTORE = "file";
  try {
    assert.equal(openKeyStore().backend, "file");
  } finally {
    if (prev === undefined) delete process.env.KEYLINE_KEYSTORE;
    else process.env.KEYLINE_KEYSTORE = prev;
  }
});
