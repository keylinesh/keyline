# Findings Triage

How reviewer findings become tracked work. Every finding gets logged here and,
unless it's purely informational, a GitLab follow-up issue.

## Severity → action

| Severity | Action | Gate |
|---|---|---|
| **Critical / High** | GitLab issue, `priority::high`, `type::security`. | **Blocks** the public ZK claim / launch until fixed + re-checked. |
| **Medium** | GitLab issue, `priority::medium`. | Fix before GA; may ship beta with it documented. |
| **Low** | GitLab issue, `priority::low`. | Backlog; fix opportunistically. |
| **Informational** | Log below; issue optional. | None. |

## Creating follow-up issues

Use the existing GitLab automation (project `83574832`). One issue per finding:

- Title: `security: <short finding title>`
- Labels: `area::crypto`, `type::security`, severity-based `priority::*`
- Body: reviewer's description, impact, repro, recommended fix, link to the report
- Milestone: M1 if it gates launch, otherwise the milestone that owns the code

## Findings log

_Filled in when the report lands._

| # | Finding | Severity | Follow-up issue | Status |
|---|---|---|---|---|
| – | _none yet_ | – | – | – |

## Sign-off

The review is **complete** for M1 purposes when:

- [ ] All Critical and High findings are fixed and re-verified by the reviewer.
- [ ] Medium findings are either fixed or explicitly accepted and documented.
- [ ] `docs/encryption-design.md` is updated to reflect any design changes.
- [ ] The reviewer's go/no-go statement is recorded here.
