/**
 * Secure local key storage for device private keys.
 *
 * A device private key never leaves the machine. We store it in the OS keychain
 * where one is available (macOS today), and fall back to a file with strict
 * permissions (0600 in a 0700 directory) everywhere else.
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
import { execFileSync } from "node:child_process";

export interface KeyStore {
  /** Identifies the backend in use (e.g. "macos-keychain", "file"). */
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
 * File-backed store. The default secure store on platforms without a keychain
 * integration, and the fallback when a keychain is unavailable.
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

/**
 * macOS keychain store via the `security` CLI.
 *
 * Security note: `security add-generic-password` takes the secret as an argv
 * value, which is briefly visible to other processes of the same user via `ps`.
 * The keychain itself is the hardened store; closing that argv window means
 * replacing the CLI with a native binding (e.g. @napi-rs/keyring) — tracked as a
 * hardening follow-up. For now this is gated to macOS and is strictly better at
 * rest than a plaintext file.
 */
export class MacKeychainStore implements KeyStore {
  readonly backend = "macos-keychain";

  static isAvailable(): boolean {
    if (process.platform !== "darwin") return false;
    try {
      execFileSync("security", ["help"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  get(account: string): string | null {
    assertAccount(account);
    try {
      const out = execFileSync(
        "security",
        ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
        { encoding: "utf8" },
      );
      return out.replace(/\n$/, "");
    } catch {
      // Non-zero exit means the item does not exist.
      return null;
    }
  }

  set(account: string, secret: string): void {
    assertAccount(account);
    // -U updates the item in place if it already exists.
    execFileSync(
      "security",
      [
        "add-generic-password",
        "-U",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        account,
        "-w",
        secret,
      ],
      { stdio: "ignore" },
    );
  }

  delete(account: string): void {
    assertAccount(account);
    try {
      execFileSync(
        "security",
        ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account],
        { stdio: "ignore" },
      );
    } catch {
      // Item did not exist — nothing to delete.
    }
  }
}

/**
 * Pick the best available store: OS keychain where present, file otherwise.
 *
 * Override with KEYLINE_KEYSTORE=file|keychain (mainly for tests and for users
 * who prefer the file store).
 */
export function openKeyStore(opts: { baseDir?: string } = {}): KeyStore {
  const forced = process.env.KEYLINE_KEYSTORE;
  if (forced === "file") return new FileKeyStore(opts.baseDir);
  if (forced === "keychain") return new MacKeychainStore();
  if (MacKeychainStore.isAvailable()) return new MacKeychainStore();
  return new FileKeyStore(opts.baseDir);
}
