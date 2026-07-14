import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileKeyStore,
  NativeKeychainStore,
  openKeyStore,
  withLegacyMigration,
  type KeyringEntryCtor,
  type LegacyReader,
} from "./keystore.js";

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

/** A fake @napi-rs/keyring Entry backed by a Map, mirroring its real API. */
function fakeKeyring() {
  const vault = new Map<string, string>();
  const Entry = class {
    constructor(private readonly service: string, private readonly account: string) {}
    private k() { return `${this.service}:${this.account}`; }
    getPassword(): string | null { return vault.get(this.k()) ?? null; }
    setPassword(secret: string): void { vault.set(this.k(), secret); }
    deletePassword(): boolean { return vault.delete(this.k()); }
  } as unknown as KeyringEntryCtor;
  return { Entry, vault };
}

test("NativeKeychainStore round-trips through the binding, no argv involved", () => {
  const { Entry } = fakeKeyring();
  const store = new NativeKeychainStore(Entry);
  assert.equal(store.get("device-identity"), null);
  store.set("device-identity", "s3cret");
  assert.equal(store.get("device-identity"), "s3cret");
  store.delete("device-identity");
  assert.equal(store.get("device-identity"), null);
  store.delete("device-identity"); // no throw
});

test("legacy security-CLI entries migrate on first read and are removed", () => {
  const { Entry } = fakeKeyring();
  const native = new NativeKeychainStore(Entry);
  const legacyVault = new Map([["account", "old-secret"]]);
  const legacy: LegacyReader = {
    read: (a) => legacyVault.get(a) ?? null,
    remove: (a) => void legacyVault.delete(a),
  };
  const store = withLegacyMigration(native, legacy);

  // The legacy item must be removed BEFORE the native write (the errSec-
  // DuplicateItem fix): assert the native store held nothing until migration.
  assert.equal(native.get("account"), null, "native store starts empty");
  assert.equal(store.get("account"), "old-secret", "found via legacy");
  assert.equal(legacyVault.size, 0, "legacy entry deleted after migration");
  assert.equal(native.get("account"), "old-secret", "now lives in the native store");
  assert.equal(store.get("account"), "old-secret", "second read skips legacy");
});

test("the real native binding round-trips on this machine", { skip: !NativeKeychainStore.load() }, () => {
  const store = NativeKeychainStore.load()!;
  const account = `test-${process.pid}`;
  try {
    store.set(account, "integration-secret");
    assert.equal(store.get(account), "integration-secret");
  } finally {
    store.delete(account);
  }
  assert.equal(store.get(account), null);
});
