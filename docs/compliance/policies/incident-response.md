# Incident Response Policy

**Owner (incident commander):** founder. **Review:** yearly.

## What counts as an incident

Anything that harms, or credibly threatens, the confidentiality, integrity, or
availability of customer data or the service. Vulnerability reports arrive via
[/security](https://keyline.sh/security) and support@keyline.sh.

## Severity

| Level | Meaning | Examples |
| --- | --- | --- |
| SEV1 | Customer data at risk or service down | Credible breach, key compromise, database loss |
| SEV2 | Degraded security or availability | Auth bug with no known exploitation, sustained outage of a feature |
| SEV3 | Contained issue | Bug with security relevance, dependency CVE, failed control |

## Response steps

1. **Contain.** Revoke tokens, rotate credentials, disable the affected path.
   Vercel rollback if a deploy caused it.
2. **Assess.** What data, which customers, what window. The product audit log
   and Sentry are the primary forensic sources.
3. **Notify.** SEV1 affecting personal data: affected customers without undue
   delay, per the DPA; CPDP within 72h if GDPR requires it. Honesty beats
   polish; notify with what is known.
4. **Fix.** Root cause, not symptom. Ship through the normal MR path.
5. **Write it down.** Entry in the log below within a week: timeline, cause,
   impact, fix, what changes.

## Vulnerability reports

Acknowledge within 48 hours. Triage to a severity. Fix on a window agreed with
the reporter. Credit unless they decline. No legal action against good-faith
research. This mirrors the public commitment on /security.

## Incident log

| Date | Sev | Summary | Postmortem |
| --- | --- | --- | --- |
| — | — | none yet | — |
