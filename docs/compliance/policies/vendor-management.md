# Vendor Management Policy

**Owner:** founder. **Review:** yearly, plus before adding any vendor.

## Rules

1. A vendor that touches customer data must have a SOC 2 report (or ISO 27001)
   and a signable or automatic DPA.
2. Prefer vendors where our zero-knowledge design makes their access worthless:
   they can host ciphertext all day.
3. Adding or replacing a subprocessor updates [/dpa](https://keyline.sh/dpa)
   at least 14 days in advance. That page is the customer-facing register.
4. Send each vendor the least data that works (Sentry gets scrubbed events,
   the anchors repo gets only hashes).

## Register

| Vendor | Purpose | Customer data touched | Attestation | DPA |
| --- | --- | --- | --- | --- |
| Vercel | Hosting, serverless, env | All server-side data in transit | SOC 2 | yes |
| Neon | Postgres | Ciphertext, metadata, audit events at rest | SOC 2 | yes |
| Paddle | Merchant of record | Billing data, as independent controller | SOC 2 | own terms |
| Resend | Transactional email | Member emails, invite/sign-in mails | SOC 2 | yes |
| Sentry | Error monitoring | Scrubbed events only, EU region | SOC 2 | yes |
| GitLab | Code, CI, public anchors | None (anchors are hashes) | SOC 2 | n/a |
| Google Fonts | Web fonts on static pages | Visitor IPs at load time | n/a | n/a |

## Annual review

On the yearly pass: confirm each vendor still holds its attestation, drop
vendors no longer used, and re-check that the DPA page matches this table.
