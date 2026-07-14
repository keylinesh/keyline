# Change Management Policy

**Owner:** founder. **Review:** yearly.

## How code reaches production

1. Every change starts as a GitLab issue and a branch. No direct commits to
   `main`; the branch is protected.
2. Every change merges through an MR. CI must be green: lint, typecheck, unit
   tests, and Postgres integration tests.
3. The founder reviews and merges. Self-review is a real limitation; the
   compensating controls are the CI gates and the permanent MR record.
4. Merge to `main` deploys to production via Vercel. Deploys are atomic and
   instantly revertable to the previous build.
5. Database migrations are plain SQL, numbered, applied deliberately against
   Neon, and never edited after they ship.

## Emergency changes

Same path. The pipeline takes minutes; skipping it has caused more incidents
in the industry than it has ever prevented. A revert MR is the fast path.

## Dependencies

Dependency updates go through the same MR flow. A scheduled audit job is the
open action from the gap assessment (CC7).

## Evidence

GitLab keeps it all: MRs, pipelines, approvals, deploy history. Nothing to
collect by hand.
