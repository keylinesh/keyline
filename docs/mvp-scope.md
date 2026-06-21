# Keyline: MVP Scope, Success Metrics & Non-Goals

- **Status:** draft (M0)
- **Date:** 2026-06-20
- **Owner:** Resi

This is the contract for what v1 is, and just as importantly what it is **not**. When a new idea appears, check it against the non-goals before saying yes.

## What the MVP must prove

1. **The zero-knowledge guarantee is real.** Secrets are encrypted client-side. A full breach of our servers yields only ciphertext.
2. **The one-command flow is genuinely fast.** Install → link → pull in under two minutes, learning zero new concepts.
3. **A small team can run on it daily.** Push/pull/run, members, revoke, audit, without falling back to Slack.

If those three hold, the wedge is validated. Everything else is in service of them.

## In scope (v1)

| Surface | In scope |
|---|---|
| **Crypto** (M1) | AES-256-GCM secret bundles; workspace-key KDF; per-device keypairs; per-member envelope encryption; admin-device + sealed-file recovery; published design doc; external review |
| **API** (M2) | Device auth + scoped tokens; push/pull ciphertext; workspace/project/env CRUD; per-env RBAC; tamper-evident audit log; server-side revoke/rotate; rate limiting |
| **CLI** (M3) | `login · link · push · pull · run · rotate · revoke · audit · members`; sub-2-min first run; npm + Homebrew + curl\|sh distribution |
| **Dashboard** (M4) | Auth; workspace/project/env management; member management; audit viewer; onboarding. **Metadata only** (see [ADR-0002](decisions/0002-zero-knowledge-boundary.md)) |
| **Payments** (M5) | Stripe Solo ($0) + Team ($19 flat); 14-day trial; billing portal; webhooks (verified + idempotent); subscription state machine; entitlement enforcement; tax/invoices; dunning; reconciliation |
| **Trust/Launch** (M6) | Public encryption doc; security posture + vuln disclosure; ToS/Privacy/DPA; SOC 2 readiness started; observability; private beta → public launch |

## Non-goals (explicitly NOT in v1)

- ❌ **Editing/viewing secret _values_ in the browser.** Values stay CLI-only (ADR-0002).
- ❌ **Self-host / open-source edition.** Revisit after hosted traction (open question in `keyline-context.md` §10).
- ❌ **Deep per-platform integrations** beyond the one beachhead ecosystem (see [ICP](icp.md)). "Works with everything" is a post-MVP goal.
- ❌ **Per-seat billing / >10-seat tier.** Flat $19 only for now. Expansion tier is a later decision.
- ❌ **SSO/SAML, SCIM, fine-grained org roles.** "SSO-ready" architecture, but not shipped in v1.
- ❌ **Secret scanning, rotation automation, or CI secret injection** beyond `keyline run`.
- ❌ **Mobile apps.**

## Success metrics

**Pre-launch (validation):**
- Waitlist signups from the landing page (target: set a number before driving traffic).
- Landing-page → waitlist conversion rate.

**Beta (does it work for real teams):**
- **Time-to-first-pull** (install → first successful `pull`). Target median < 2 min.
- First-run success rate (% who reach a successful `pull` without support).
- Weekly active teams; pull/push events per team per week (the retention signal).

**Launch:**
- Solo → Team trial starts; trial → paid conversion.
- Logo retention at 30/60/90 days (this segment churns, so watch it).

## Definition of done for the MVP

- A new team can sign up, install the CLI, link a project, and `pull`/`run` their secrets in under two minutes.
- The encryption design doc is public and has passed external review.
- A team can pay for Team, hit plan limits, and manage billing self-serve.
- Audit log answers "who touched prod?" and is tamper-evident.
