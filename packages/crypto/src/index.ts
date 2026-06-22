/**
 * @keyline/crypto — client-side encryption for the zero-knowledge scheme.
 *
 * Layers:
 *   - bundle:   AES-256-GCM encryption of secret bundles under the workspace key
 *   - kdf:      scrypt derivation of the workspace key from a customer secret
 *   - keypair:  per-device X25519 keypairs
 *   - envelope: wrap/unwrap the workspace key to a device public key
 *   - recovery: sealed recovery file under a passphrase
 *   - admin-recovery: admin-device flow to re-grant a lost member's access
 *
 * The authoritative design and threat model live in docs/encryption-design.md.
 * The scheme must pass an external security review before it ships.
 */

export * from "./bundle.js";
export * from "./kdf.js";
export * from "./keypair.js";
export * from "./envelope.js";
export * from "./recovery.js";
export * from "./admin-recovery.js";
