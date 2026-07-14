# SOC 2 Gap Assessment

Assessed July 2026 against the 2017 Trust Services Criteria (Security / common
criteria). Ratings are honest: **OK** (control exists and produces evidence),
**PARTIAL** (exists, evidence or formality missing), **GAP** (does not exist).

## CC1: Control environment

| Criterion | State | Notes |
| --- | --- | --- |
| Integrity and ethical values | PARTIAL | One founder; values are practiced, now written into [information-security.md](policies/information-security.md) |
| Board oversight | GAP | No board. Acceptable for size; auditors expect it named as such |
| Organizational structure | OK | Trivially simple: founder owns everything, documented |
| Competence and accountability | PARTIAL | No HR process; hiring policy deferred until first hire |

## CC2: Communication and information

| Criterion | State | Notes |
| --- | --- | --- |
| Internal communication | OK | Everything is written: repo docs, ADRs, GitLab issues |
| External communication | OK | /security, /terms, /privacy, /dpa, security.txt, status honesty |
| Security commitments to customers | OK | ToS + DPA state them; the product design enforces them |

## CC3 / CC4: Risk assessment and monitoring

| Criterion | State | Notes |
| --- | --- | --- |
| Risk identification | PARTIAL | Threat model exists in encryption-design.md; business-level risk register is this document, refresh yearly |
| Fraud risk | OK | Paddle as merchant of record carries payment fraud |
| Monitoring of controls | PARTIAL | Sentry + CI are continuous; quarterly evidence day adds the manual sweep |
| External review | GAP | Independent security review not yet engaged (#18, launch gate) |

## CC5 / CC6: Control activities and access

| Criterion | State | Notes |
| --- | --- | --- |
| Logical access control | OK | Device-key auth, per-environment grants, hashed scoped tokens, 8h web sessions |
| Access provisioning/deprovisioning | OK | Invitation-only join codes; one-step revoke drops tokens, wrapped keys, devices |
| Privileged access | PARTIAL | Founder holds all admin access with 2FA; no second person, so reviews are self-reviews. Named honestly |
| Encryption at rest / in transit | OK | Client-side AES-256-GCM before upload; TLS everywhere; Neon encrypts at rest |
| Key management | OK | Public design doc; keys never reach the server; recovery is customer-held |
| Physical security | OK | Inherited from Vercel, Neon (SOC 2 certified vendors); founder hardware uses FileVault |

## CC7: System operations

| Criterion | State | Notes |
| --- | --- | --- |
| Vulnerability management | OK | Weekly `dep-audit` CI job gates production deps at moderate+. Known dev-chain advisories (inside @vercel/node's build tooling, latest version, no fix available upstream) are accepted and re-checked when bumping it |
| Security monitoring | OK | Sentry with double-scrub; rate limiting; product audit log anchored publicly |
| Incident response | PARTIAL | Practice exists; formal severity levels and log now in [incident-response.md](policies/incident-response.md) |
| Backup and recovery | PARTIAL | Neon PITR exists; restore never rehearsed. Rehearsal scheduled in [business-continuity.md](policies/business-continuity.md) |

## CC8: Change management

| Criterion | State | Notes |
| --- | --- | --- |
| Change process | OK | Protected main, MR-only merges, CI gates (lint, typecheck, tests, pg tests) |
| Change approval | PARTIAL | Founder approves own MRs; compensating control is CI plus full git history. Named honestly |
| Emergency changes | OK | Same MR path; speed comes from CI, not bypass |

## CC9: Risk mitigation

| Criterion | State | Notes |
| --- | --- | --- |
| Vendor risk | OK | Small vendor set, all SOC 2 certified; register in [vendor-management.md](policies/vendor-management.md) |
| Business disruption | PARTIAL | Bus factor of one. Mitigations in [business-continuity.md](policies/business-continuity.md) |

## Actions from this assessment

1. ~~Write the policy set~~ done, [policies/](policies/).
2. ~~Add a scheduled dependency audit job to CI (CC7)~~ done: `dep-audit` in
   `.gitlab-ci.yml`. **Founder: add a weekly pipeline schedule in GitLab
   (CI/CD → Schedules).** Shipping it also fixed real findings: @sentry/node
   8 to 10 (vulnerable transitive @opentelemetry/core), vitest 2 to 3, vite 6
   to 7, @vercel/node bumped.
3. Rehearse a Neon restore and log the result (CC7). Scheduled for the next
   evidence day.
4. Engage the external security review (#18). Funded decision, launch gate.
5. Revisit this document yearly, or when the company stops being one person.
