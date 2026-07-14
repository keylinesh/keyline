/**
 * Secure local key storage for device private keys.
 *
 * A device private key never leaves the machine. Preferred store since #62:
 * the OS keychain via the @napi-rs/keyring native binding (macOS Keychain,
 * Windows Credential Manager, Linux secret-service) — the secret crosses into
 * the keychain in-process, never on a command line. Fallback: a file with
 * strict permissions (0600 in a 0700 directory).
 *
 * History: v0.1.x wrote via the macOS `security` CLI, which briefly exposed
 * the secret as an argv value visible to same-user processes (`ps`). That
 * path is now READ-ONLY: reads never leaked (the secret is in stdout, not
 * argv), so existing entries are migrated to the new store on first access
 * and deleted from the legacy location. We never write through `security`
 * again.
 *
 * The store holds a single secret string per account. The device layer
 * (device.ts) serializes the full DeviceIdentity as JSON and keeps it here.
 */

import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

export interface KeyStore {
  /** Identifies the backend in use (e.g. "keychain", "file"). */
  readonly backend: string;
  /** Return the stored secret for an account, or null if absent. */
  get(account: string): string | null;
  /** Store (or replace) the secret for an account. */
  set(account: string, secret: string): void;
  /** Remove the secret for an account. No-op if absent. */
  delete(account: string): void;
}

const KEYCHAIN_SERVICE = "keyline";

/** Reject account names that could escape the key directory or confuse the keychain. */
function assertAccount(account: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(account)) {
    throw new Error(`invalid keystore account: ${JSON.stringify(account)}`);
  }
}

/**
 * File-backed store. The fallback wherever the native keychain binding is
 * unavailable (unsupported platform, or the optional dependency didn't
 * install).
 *
 * Layout: `<baseDir>/<account>.key`, file mode 0600, directory mode 0700.
 */
export class FileKeyStore implements KeyStore {
  readonly backend = "file";
  private readonly baseDir: string;

  constructor(baseDir: string = join(homedir(), ".keyline", "keys")) {
    this.baseDir = baseDir;
  }

  private pathFor(account: string): string {
    assertAccount(account);
    return join(this.baseDir, `${account}.key`);
  }

  private ensureDir(): void {
    // mkdir's mode is masked by umask, so chmod afterwards to guarantee 0700.
    mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    chmodSync(this.baseDir, 0o700);
  }

  get(account: string): string | null {
    try {
      return readFileSync(this.pathFor(account), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  set(account: string, secret: string): void {
    this.ensureDir();
    const p = this.pathFor(account);
    writeFileSync(p, secret, { mode: 0o600 });
    // Guarantee 0600 even if the file already existed with looser perms.
    chmodSync(p, 0o600);
  }

  delete(account: string): void {
    try {
      unlinkSync(this.pathFor(account));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

/** The slice of @napi-rs/keyring we use; injectable for tests. */
export interface KeyringEntryCtor {
  new (service: string, account: string): {
    getPassword(): string | null;
    setPassword(secret: string): void;
    deletePassword(): boolean;
  };
}

/**
 * OS keychain via the native binding. The secret never appears on any
 * process's command line.
 */
export class NativeKeychainStore implements KeyStore {
  readonly backend = "keychain";

  constructor(private readonly Entry: KeyringEntryCtor) {}

  /** null when the optional native dependency isn't installed/loadable. */
  static load(): NativeKeychainStore | null {
    try {
      const require = createRequire(import.meta.url);
      const mod = require("@napi-rs/keyring") as { Entry: KeyringEntryCtor };
      return new NativeKeychainStore(mod.Entry);
    } catch {
      return null;
    }
  }

  get(account: string): string | null {
    assertAccount(account);
    try {
      return new this.Entry(KEYCHAIN_SERVICE, account).getPassword();
    } catch {
      return null;
    }
  }

  set(account: string, secret: string): void {
    assertAccount(account);
    const entry = new this.Entry(KEYCHAIN_SERVICE, account);
    try {
      entry.setPassword(secret);
    } catch {
      // A stale/duplicate item is blocking the add; drop it and retry once.
      entry.deletePassword();
      entry.setPassword(secret);
    }
  }

  delete(account: string): void {
    assertAccount(account);
    try {
      new this.Entry(KEYCHAIN_SERVICE, account).deletePassword();
    } catch {
      // Item did not exist — nothing to delete.
    }
  }
}

/** Reads (only) legacy `security`-CLI keychain items, for migration. */
export interface LegacyReader {
  read(account: string): string | null;
  remove(account: string): void;
}

export function macSecurityLegacyReader(): LegacyReader | null {
  if (process.platform !== "darwin") return null;
  return {
    read(account: string): string | null {
      assertAccount(account);
      try {
        const out = execFileSync(
          "security",
          ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        );
        return out.replace(/\n$/, "");
      } catch {
        return null;
      }
    },
    remove(account: string): void {
      try {
        execFileSync(
          "security",
          ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account],
          { stdio: "ignore" },
        );
      } catch {
        // Already gone.
      }
    },
  };
}

/**
 * Wrap a store with one-time migration from the legacy location: a miss
 * checks the legacy keychain, and a hit is moved into the new store.
 */
export function withLegacyMigration(primary: KeyStore, legacy: LegacyReader | null): KeyStore {
  if (!legacy) return primary;
  return {
    backend: primary.backend,
    get(account: string): string | null {
      const current = primary.get(account);
      if (current !== null) return current;
      const old = legacy.read(account);
      if (old === null) return null;
      // Remove the legacy item BEFORE writing the native one. The native
      // binding and the `security` CLI create distinct keychain items for the
      // same service/account, so a native write while the legacy item exists
      // fails with errSecDuplicateItem. Deleting via the CLI (which reliably
      // removes its own item) first clears the collision. The value is held in
      // memory across this one synchronous step.
      legacy.remove(account);
      primary.set(account, old);
      return old;
    },
    set: (account, secret) => primary.set(account, secret),
    delete(account: string): void {
      primary.delete(account);
      legacy.remove(account);
    },
  };
}

/**
 * Pick the best available store: native OS keychain where the binding loads,
 * file otherwise — both behind legacy migration on macOS.
 *
 * Override with KEYLINE_KEYSTORE=file|keychain (mainly for tests and for users
 * who prefer the file store).
 */
export function openKeyStore(opts: { baseDir?: string } = {}): KeyStore {
  const forced = process.env.KEYLINE_KEYSTORE;
  const legacy = macSecurityLegacyReader();
  if (forced === "file") return withLegacyMigration(new FileKeyStore(opts.baseDir), legacy);
  const native = NativeKeychainStore.load();
  if (forced === "keychain") {
    if (!native) throw new Error("the native keychain binding is not available on this install");
    return withLegacyMigration(native, legacy);
  }
  return withLegacyMigration(native ?? new FileKeyStore(opts.baseDir), legacy);
}
