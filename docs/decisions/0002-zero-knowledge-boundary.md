# ADR-0002: Zero-knowledge boundary (does plaintext ever touch the browser?)

- **Status:** proposed
- **Date:** 2026-06-20
- **Deciders:** Resi

## Context

Keyline's central marketing claim is **"we can't read your secrets."** That claim is only true if our servers never receive plaintext secrets *and* never serve code/data that would require them to.

A web dashboard creates tension: the moment the browser displays or edits a secret **value**, the browser must hold plaintext. Since we serve the dashboard's JavaScript, a sufficiently motivated or compromised server could ship code that exfiltrates that plaintext — which weakens "zero-knowledge" from a cryptographic guarantee to a "trust our served code" promise. This is the single most important thing to get right (see `keyline-context.md` §4a).

## Decision (proposed — to be confirmed in M1)

**Default: secret _values_ are CLI-only.** The web dashboard operates on **metadata only** — workspaces, projects, environments, members, access scopes, billing, and the audit log. It never decrypts or displays secret values.

If product needs later justify in-browser secret viewing/editing, it must be a deliberate, separately-scoped decision with: client-side-only decryption, published browser-crypto design, subresource integrity, and explicit user-facing language that this surface trades some of the zero-knowledge guarantee for convenience.

## Consequences

- Keeps the strong, defensible version of the claim: a breach of the server (DB *and* app) still cannot read secrets, because the server never has the decrypt path for values.
- Constrains the dashboard scope (milestone M4): no "edit secret value in the browser" feature in v1.
- Marketing copy on `index.html` and the README must match this boundary exactly — no implication that you manage secret values in the web UI.

## Alternatives considered

- **Browser can decrypt values** — better dashboard UX, but downgrades the core trust claim; rejected for v1.
- **No dashboard at all** — purest story, but non-CLI teammates can't manage members/audit; rejected as too limiting.
