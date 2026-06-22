# Keyline: Encryption Design

- **Status:** draft. Must pass an external security review before launch.
- **Scope:** the client-side, zero-knowledge scheme. The server stores only ciphertext, wrapped keys, metadata, and audit events.

This document is public on purpose. The claim "we can't read your secrets" must be verifiable, not asserted.

## Goals

- The server never sees plaintext secrets or the workspace master key.
- A full breach of our database yields only ciphertext.
- Adding or removing a member does not require re-encrypting every secret.
- Lost devices are recoverable through an admin device or a customer-held file.

## Primitives

All primitives are from Node's built-in `crypto`. No third-party crypto libraries.

| Purpose | Primitive |
|---|---|
| Secret encryption | AES-256-GCM |
| Workspace key derivation | scrypt (N=2^15, r=8, p=1) |
| Device keypairs | X25519 |
| Key agreement | X25519 ECDH |
| Key wrapping derivation | HKDF-SHA256 |

## Key hierarchy

1. **Workspace secret**: a value the customer controls. Never sent to the server.
2. **Workspace key** (32 bytes): derived from the workspace secret via scrypt. Encrypts all secret bundles. Held in client memory only.
3. **Device keypair**: a per-device X25519 keypair. The private key stays on the device. The public key is registered with the server.
4. **Wrapped key**: the workspace key sealed to each member device's public key.

## Layers

### 1. Secret bundle (`bundle.ts`)

A set of secrets (e.g. a serialized `.env`) is sealed with AES-256-GCM under the workspace key. A random 96-bit nonce per seal. Output is `{ v, nonce, ciphertext, tag }`. The server stores only this.

### 2. Workspace key derivation (`kdf.ts`)

`workspaceKey = scrypt(workspaceSecret, salt, 32)`. The salt is random, stored with the workspace, and not secret. The same secret and salt re-derive the same key. The server never receives the secret or the key.

### 3. Device keypairs (`keypair.ts`)

On first login a device generates an X25519 keypair. Public keys are stored as base64 SPKI DER; private keys as base64 PKCS8 DER, kept on the device. The private key is held in the OS keychain where available (macOS today), with a file fallback at `~/.keyline/keys/` (file mode 0600, directory mode 0700). Only the public key and a device id are registered with the server. See `apps/cli/src/keystore.ts` and `apps/cli/src/device.ts`.

### 4. Envelope encryption (`envelope.ts`)

Wrapping the workspace key to a recipient device, a sealed-box construction:

1. Generate an ephemeral X25519 keypair.
2. `shared = ECDH(ephemeralPrivate, recipientPublic)`.
3. `aesKey = HKDF-SHA256(shared, salt = SHA256(ephPub || recipientPub), info = "keyline-envelope-v1")`.
4. AES-256-GCM encrypt the workspace key under `aesKey`.

The HKDF salt binds the wrap to both public keys, so a wrap cannot be replayed to a different recipient. Output is `{ v, eph, nonce, ct, tag }`. Unwrapping reverses it with the device private key.

Adding a member produces a new wrapped key. Revoking a member deletes their wrapped key and tokens. Secret bundles are never touched.

### 5. Recovery (`recovery.ts` + admin re-wrap)

Two paths:

- **Admin device.** Any active admin device can restore a member who lost theirs. The flow (`admin-recovery.ts`):
  1. The server selects an active admin device for the workspace (`selectRecoveryAdmin`). If there are none, recovery stops with a clear message and the only option is a sealed recovery file.
  2. On that admin's machine, the admin unwraps the workspace key with their device key and re-wraps it to the new device's public key (`recoverToNewDevice` → `rewrapWorkspaceKey`).
  3. The new wrapped key is stored against the new device. The member unwraps it locally. The workspace key never leaves a member device in plaintext, and the server only ever moves wrapped keys. Auth and storage are in the API (M2).
- **Sealed recovery file.** The workspace key is sealed with AES-256-GCM under a key derived (scrypt) from a recovery passphrase the customer holds. Importing it restores access.

Honest limit: if every device is lost and there is no recovery file, the workspace key is unrecoverable. That is the point of zero-knowledge.

## What the server can and cannot see

**Can see:** ciphertext bundles, wrapped keys, device public keys, KDF salts, member and environment metadata, audit events.

**Cannot see:** the workspace secret, the workspace key, any device private key, or any plaintext secret.

## Threat model

- **Database breach.** Attacker gets ciphertext and wrapped keys. Without a device private key or the workspace secret, nothing decrypts.
- **Malicious or compromised server.** Cannot read existing secrets. It could serve bad client code; mitigated by signed CLI releases and a published design. The web dashboard never handles secret values (see [ADR-0002](decisions/0002-zero-knowledge-boundary.md)).
- **Lost device.** Revoke it; recover via admin device or recovery file.
- **Tampering.** AES-GCM authentication fails closed on any modified ciphertext, nonce, or tag.

## Not covered here yet

- Tamper-evident audit log (hash-chained). Milestone M2.
- Token and session design. Milestone M2.
- Formal external review. Packet prepared in [`docs/security-review/`](security-review/README.md); engagement pending (M1 #18).

## Status

Implemented in `packages/crypto` with round-trip, wrong-key, and tamper tests. This is an engineering draft, not a reviewed specification. Do not treat the guarantees as final until the external review is complete.
