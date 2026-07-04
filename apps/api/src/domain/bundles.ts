/**
 * Secret bundles + wrapped keys — the core encrypted data path (#22).
 *
 * The server stores and returns only ciphertext. Push appends a new immutable
 * version of an environment's SealedBundle; pull returns the latest plus the
 * calling device's wrapped workspace key so it can decrypt locally.
 *
 * Optimistic concurrency: a push may pass the baseVersion it last saw. If that
 * no longer matches the latest stored version, the push is rejected so a
 * concurrent writer is never silently clobbered.
 */

export interface StoredBundle {
  id: string;
  environmentId: string;
  /** Monotonic per environment, starting at 1. */
  version: number;
  /** SealedBundle.v — the ciphertext format version. */
  formatVersion: number;
  nonce: string;
  ciphertext: string;
  tag: string;
  createdByDeviceId: string | null;
  createdAt: Date;
}

export interface AppendBundleInput {
  environmentId: string;
  /** The version the client last saw; if set and stale, the append is rejected. */
  baseVersion?: number;
  formatVersion: number;
  nonce: string;
  ciphertext: string;
  tag: string;
  /** The device that pushed it; null for system-originated writes. */
  createdByDeviceId: string | null;
}

/** Thrown when a push's baseVersion is stale (someone else pushed first). */
export class VersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super(`bundle version conflict; latest stored version is ${currentVersion}`);
    this.name = "VersionConflictError";
  }
}

export interface BundleRepo {
  getLatest(environmentId: string): Promise<StoredBundle | null>;
  /** Append the next version atomically; throws VersionConflictError on a stale baseVersion. */
  append(input: AppendBundleInput): Promise<StoredBundle>;
}

/** The workspace key sealed to one device (envelope.ts WrappedKey shape). */
export interface StoredWrappedKey {
  workspaceId: string;
  deviceId: string;
  formatVersion: number;
  eph: string;
  nonce: string;
  ct: string;
  tag: string;
}

export interface WrappedKeyRepo {
  findForDevice(workspaceId: string, deviceId: string): Promise<StoredWrappedKey | null>;
  /**
   * Whether ANY device in the workspace holds a wrapped key. Distinguishes a
   * brand-new workspace (the CLI may generate the workspace key, #32) from a
   * device that simply hasn't been granted one (ask an admin).
   */
  existsForWorkspace(workspaceId: string): Promise<boolean>;
  /** Insert or replace a device's wrapped key (used by membership/recovery, #23/#25). */
  upsert(key: StoredWrappedKey): Promise<void>;
  /** Delete a device's wrapped key (used by member revoke, #25). Returns true if one existed. */
  deleteForDevice(workspaceId: string, deviceId: string): Promise<boolean>;
}
