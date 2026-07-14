# SOC 2 Readiness Program

Keyline is not SOC 2 certified. This directory is the readiness program: know the
gaps, write the policies, collect evidence from day one, and audit when revenue
justifies the cost. The public [/security](https://keyline.sh/security) page states
this honestly.

> GitLab issue: **M6 #55 — Start SOC 2 Type II readiness program.**

## Status

- [x] Gap assessment against the Trust Services Criteria — [gap-assessment.md](gap-assessment.md)
- [x] Core policies drafted and adopted — [policies/](policies/)
- [x] Evidence and tooling decision made — below
- [ ] Compliance platform onboarded — **deferred until the audit is funded**
- [ ] Type II observation window started
- [ ] Audit firm engaged — **owner: founder; needs budget**

## Scope

Trust Services Criteria: **Security** (the common criteria) only. Availability and
Confidentiality can be added at audit time if customers ask. Processing Integrity
and Privacy stay out of scope; the [DPA](https://keyline.sh/dpa) and
[privacy policy](https://keyline.sh/privacy) already cover the privacy commitments
we make.

## The honest framing

Keyline is a one-person company. Many SOC 2 controls assume teams: separation of
duties, security committees, HR onboarding. Pretending otherwise would fail an
audit and deserve to. The program therefore does two things:

1. **Automate what a team would do by hand.** Protected branches, CI gates,
   scrubbed error tracking, a tamper-evident audit log that is anchored publicly.
   Tooling does not get tired and does not skip steps.
2. **Write down what actually happens.** Each policy describes real practice.
   When practice and policy differ, one of them changes the same week.

## Evidence and tooling decision

**Decision: manual evidence now, compliance platform later.**

Platforms like Vanta, Drata, and Secureframe cost roughly $8k to $25k per year
plus the audit itself. That is not defensible before meaningful revenue. What they
mostly automate is evidence collection, and our stack already produces durable
evidence for free:

| Evidence | Source, kept automatically |
| --- | --- |
| Change management | GitLab MRs, protected `main`, CI pipelines |
| Access reviews | Vercel/Neon/GitLab member lists, quarterly screenshot |
| Security monitoring | Sentry issues + alert emails |
| Backup and recovery | Neon point-in-time restore, restore test log |
| Product audit trail | Hash-chained log, daily public anchors |
| Vendor management | [policies/vendor-management.md](policies/vendor-management.md) register |
| Incident response | Incident log in [policies/incident-response.md](policies/incident-response.md) |

Manual cadence: a quarterly "evidence day" (calendar reminder), collecting the
screenshots and review notes into a private `evidence/` folder outside this repo.

**Revisit trigger:** first enterprise prospect that requires a report, or ~$2k MRR,
whichever comes first. At that point pick a platform (Vanta or Drata; get fresh
quotes, they change yearly) and an auditor, and start the 3-month Type II window.

## Policy set

| Policy | Covers |
| --- | --- |
| [Information security](policies/information-security.md) | The master policy; roles, review cycle |
| [Access control](policies/access-control.md) | Accounts, keys, least privilege, offboarding |
| [Change management](policies/change-management.md) | How code reaches production |
| [Incident response](policies/incident-response.md) | Severity levels, steps, disclosure, log |
| [Vendor management](policies/vendor-management.md) | Vendor register and review |
| [Data management](policies/data-management.md) | Classification, retention, disposal |
| [Business continuity](policies/business-continuity.md) | Backups, recovery, bus factor |

All policies are reviewed yearly at minimum. The git history is the approval record:
the founder merges every policy change.
