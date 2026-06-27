# Infrastructure & Deployment

The runtime stack and how to stand it up reproducibly. Milestone M2 (#27/#28).

## Stack

| Concern | Choice | Why |
|---|---|---|
| Database | **Neon** (managed Postgres) | Serverless, Vercel-native, the successor to Vercel Postgres. |
| API hosting | **Vercel** (Hono via the Vercel adapter) | Same platform as the marketing site; serverless, TLS at the edge. |
| Marketing site | Vercel (static) | Already live. |
| Migrations | Plain SQL + `pnpm --filter @keyline/api db:migrate` | Portable, no ORM, reviewable. |
| CI | GitLab CI (`.gitlab-ci.yml`) | install → build → lint/typecheck/test. |

The API connects with TLS automatically for any non-local host
(`src/db/connection.ts`); local Postgres connects without SSL.

## Environments

| Env | Branch | Neon branch | `DATABASE_URL` set in |
|---|---|---|---|
| Production | `main` | `production` (Neon default) | Vercel (Production), GitLab CI (protected) |
| Preview | feature branches | per-deploy Neon branch | Vercel (Preview) — auto-injected by the Neon integration |

> Note: the Vercel↔Neon integration creates a Neon **branch per deployment**.
> The free plan has a branch quota — delete old branches in the Neon console if a
> deploy fails with "Branch limit reached", or limit branching to Production.

## One-time setup (#27)

1. **Provision Postgres** — already done via the Vercel Neon integration
   (project `neon-cobalt-engine`). Confirm it exists in the Neon console.
2. **Get the connection string** — Neon console → project → **Connection Details**
   → copy the `postgres://…?sslmode=require` URI (pooled connection is fine).
   Treat it as a secret; do not commit it.
3. **Set `DATABASE_URL`**
   - **Vercel**: Project → Settings → Environment Variables → add `DATABASE_URL`
     for Production (and Preview if not auto-injected).
   - **GitLab CI**: Project → Settings → CI/CD → Variables → add `DATABASE_URL`,
     **Masked + Protected** (so only protected branches see it).
4. **Run migrations** against the database:
   ```bash
   export DATABASE_URL='postgres://…?sslmode=require'   # do not paste into chat
   pnpm --filter @keyline/api db:migrate
   ```
   Idempotent — re-running applies only new migrations. Tracked in
   `schema_migrations`.

## Deploy pipeline (#28)

- Marketing site deploys from `vercel.json` (static `public/`).
- API deploys as Vercel serverless functions from the Hono app (adapter entry
  added under `apps/api`). Production deploys on merge to `main`.
- Migrations run as a release step before/with each production deploy (or
  manually via step 4 for the first cutover).

## Reproducibility

Everything needed to recreate the runtime is in the repo: schema as SQL
migrations, app config via env vars (`DATABASE_URL`, `PORT`, `NODE_ENV`), CI as
`.gitlab-ci.yml`, and static hosting as `vercel.json`. The only manual,
out-of-repo inputs are the secret values (`DATABASE_URL`) set in Vercel/GitLab.
