# Business Continuity Policy

**Owner:** founder. **Review:** yearly. Restore rehearsal: quarterly evidence day.

## What failure means here

The comforting part of zero-knowledge: Keyline going down never exposes
secrets, and customers always hold a local escape hatch (`keyline pull` writes
a plain `.env`; their app keeps running without us).

## Backups and recovery

| Asset | Protection | Recovery |
| --- | --- | --- |
| Postgres (Neon) | Point-in-time restore on a rolling window | Restore branch, repoint DATABASE_URL. Rehearse quarterly and log the result |
| Application | Everything deploys from git | Vercel keeps previous builds; instant rollback |
| Code and docs | GitLab, plus every dev machine is a full clone | Re-push from any clone |
| Audit anchors | Public repo, inherently distributed | Public record survives us |
| Vercel/DNS config | Env vars documented in memory docs + `.env` | Rebuildable in under an hour |

## Recovery targets

RPO: minutes (Neon PITR granularity). RTO: under 4 hours for a full rebuild
from nothing, assuming registrar access. Honest note: targets are asserted
until the first rehearsal; that rehearsal is a standing gap-assessment action.

## The bus factor

One founder is the real continuity risk, and no policy fixes it. Mitigations
that exist today:

- Customers are never locked in: local `.env` export works at any moment.
- Recovery credentials (registrar, GitLab, Vercel, Neon) live in the password
  manager with its own recovery kit stored offline.
- Everything operational is written down in-repo; a competent successor could
  run the service from the docs.

Before real scale: a legal-and-technical successor arrangement, and refund
posture for an orderly wind-down (the refunds page already leans customer-friendly).
