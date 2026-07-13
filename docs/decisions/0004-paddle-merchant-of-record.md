# ADR-0004: Payments via Paddle (Merchant of Record), not direct Stripe

- **Status:** accepted
- **Date:** 2026-07-13
- **Deciders:** Resi

## Context

M5 was planned as direct Stripe. But Keyline is launching before its operator
has a registered company: payouts go to an individual. Selling B2B SaaS into
the EU as a Bulgarian individual triggers VAT obligations before the first
sale (art. 97a registration), plus per-country tax logistics — exactly the
administrative surface a validation-phase product should avoid.

A Merchant of Record (MoR) is the seller of record: it charges the customer,
issues the invoice, and remits VAT/sales tax worldwide, then pays out revenue.
Our only counterparty is the MoR; income tax on payouts stays a personal
matter regardless of provider.

## Decision

**Paddle Billing as Merchant of Record** for all Keyline payments. Customers
buy from Paddle (checkout, invoices, VAT); Paddle webhooks drive our
subscription state, which flips `workspace.plan` — the entitlements layer
(#49) is billing-agnostic and unchanged.

## Consequences

- Launch without a company; no VAT registrations, invoicing, or tax filings
  toward customers on our side.
- Fees ~5% + $0.50 per transaction vs Stripe's ~2.9% — acceptable at
  validation volume; revisit at scale.
- Tax/invoice work in M5 (#50) shrinks to configuration + verification.
  Dunning/retries (#51) are mostly Paddle features to configure.
- Paddle verification requires keyline.sh to show pricing, terms, privacy,
  and a refund policy (#69).
- Migrating later (to direct Stripe under a company) means re-collecting
  payment details — subscriptions cannot be exported from an MoR. Accepted:
  do it when volume justifies it, grandfather existing subscribers carefully.

## Alternatives considered

- **Direct Stripe as an individual** — technically possible, but leaves all
  EU VAT obligations (art. 97a, OSS) on the individual; rejected for launch.
- **Lemon Squeezy** — easiest onboarding historically, but acquired by Stripe
  (2024) and effectively in maintenance mode; too risky for a new build.
- **Polar** — developer-first MoR, cheaper (~4% + 40¢), but a younger company
  with more platform risk; Paddle's maturity wins for billing infrastructure.
- **Company + Stripe from day one** — the clean end-state, but front-loads
  incorporation, accounting, and VAT before the product is validated.
