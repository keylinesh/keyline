# Security Review — Scope of Work

## Objective

Independently assess whether Keyline's client-side encryption delivers its core
promise: **the server cannot read customer secrets or the workspace key, and a
full database breach yields only ciphertext.** Confirm the design and the
implementation match, and surface any weakness that breaks that promise.

## In scope

1. **Design review** of [`docs/encryption-design.md`](../encryption-design.md):
   key hierarchy, primitive choices, and the threat model.
2. **Implementation review** of [`packages/crypto/src`](../../packages/crypto/src):
   - `bundle.ts` — AES-256-GCM secret encryption
   - `kdf.ts` — scrypt workspace-key derivation (N=2^15, r=8, p=1)
   - `keypair.ts` — X25519 device keypairs
   - `envelope.ts` — sealed-box wrap/unwrap of the workspace key
   - `recovery.ts` — passphrase-sealed recovery file
   - `admin-recovery.ts` — admin-device re-wrap flow
3. **Local key storage** in [`apps/cli/src/keystore.ts`](../../apps/cli/src/keystore.ts):
   keychain vs. file fallback, permissions, and the documented `security` CLI
   argv-exposure trade-off.

## Out of scope (for this round)

- Server-side auth, RBAC, and the tamper-evident audit log (milestone M2 — review later).
- Billing / Paddle (M5).
- Web dashboard, which by design never handles secret values (see [ADR-0002](../decisions/0002-zero-knowledge-boundary.md)).

## Questions we want answered

1. Is scrypt at N=2^15, r=8, p=1 an appropriate work factor for a
   customer-chosen workspace secret, given an offline-breach attacker? Should we
   move to a higher factor or to Argon2id?
2. Is the envelope construction (ephemeral X25519 → ECDH → HKDF-SHA256 with
   `salt = SHA256(ephPub ‖ recipientPub)`, info = `"keyline-envelope-v1"`) sound,
   and does the salt binding actually prevent wrap replay to another recipient?
3. Are there nonce-reuse, key-reuse, or domain-separation issues across the
   bundle, envelope, and recovery layers (all AES-256-GCM)?
4. Does anything in the data sent to the server (wrapped keys, salts, public
   keys, metadata) leak plaintext or enable a confirmation/oracle attack?
5. Is the absence of a separate GCM AAD field a real gap? Should the version
   byte and format fields be authenticated as associated data?
6. Failure modes: do all tamper cases fail closed? Any place an error reveals
   key material or distinguishes "wrong key" from "tampered"?
7. Local key storage: is the file fallback (0600 / 0700) adequate, and how
   should we close the keychain-CLI argv-exposure window?

## Deliverables from the reviewer

- A written report with findings rated by severity (Critical / High / Medium / Low / Info).
- For each finding: description, impact, reproduction, and recommended fix.
- A go / no-go statement on the zero-knowledge claim as currently designed.

## Logistics

- The full repo is provided; `pnpm install` then `pnpm --filter @keyline/crypto test`
  runs the suite, `pnpm --filter @keyline/crypto demo` runs the end-to-end flow.
- Findings are triaged into GitLab follow-up issues per
  [findings-triage.md](findings-triage.md).
- Target turnaround and budget: **to be set at engagement.**
