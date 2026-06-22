# External Security Review

The zero-knowledge claim must be **verified by a third party, not asserted**. This
directory is the packet we hand a reviewer and the place we track the engagement.

> GitLab issue: **M1 #18 — Engage external security review of the crypto design.**

## Status

- [x] Review packet prepared (scope, prototype, design doc) — this directory
- [x] Reviewer shortlist drafted — [reviewer-shortlist.md](reviewer-shortlist.md)
- [ ] Reviewer/firm engaged (contract signed) — **owner: founder; needs budget sign-off**
- [ ] Packet shared with the engaged reviewer
- [ ] Findings triaged into follow-up issues — [findings-triage.md](findings-triage.md)

The first two items are done in-repo. Engagement and sharing require a human
decision (budget + contract); the design and prototype are review-ready now.

## What a reviewer gets

| Artifact | Where |
|---|---|
| Encryption design + threat model | [`docs/encryption-design.md`](../encryption-design.md) |
| Zero-knowledge boundary decision | [`docs/decisions/0002-zero-knowledge-boundary.md`](../decisions/0002-zero-knowledge-boundary.md) |
| Reference implementation | [`packages/crypto/src`](../../packages/crypto/src) |
| Runnable end-to-end prototype | `pnpm --filter @keyline/crypto demo` |
| Test suite (KAT, property, tamper) | `pnpm --filter @keyline/crypto test` |
| Scope of work + questions | [scope-of-work.md](scope-of-work.md) |

## Why now

This is an M1 gate. The design is implemented and tested in-house, but
self-review does not satisfy the product's central promise. No public "we can't
read your secrets" claim ships until a reviewer has signed off and any
high-severity findings are closed.
