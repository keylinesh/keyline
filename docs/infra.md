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

## Environments (#28)

Each environment has **isolated data** (its own Neon database/branch) and its own
secret values. `APP_ENV` tells the app which it is; it drives HTTPS enforcement
and the `/health` `environment` field.

| Env | Git branch | `APP_ENV` | Neon database | Secrets live in |
|---|---|---|---|---|
| Production | `main` | `production` | Neon `production` branch (default) | Vercel **Production** env vars; GitLab CI **protected+masked** vars |
| Staging | `staging` | `staging` | a **separate** Neon branch (`staging`) | Vercel **Preview/Custom (staging)** env vars |
| Preview | feature branches | (unset → development) | per-deploy Neon branch | Vercel Preview (auto-injected by the Neon integration) |
| Local dev | — | `development` | local or a personal Neon branch | `.env` (gitignored; see `.env.example`) |

Create the staging database as a Neon **branch** of production (Neon console →
Branches → New branch) so it starts from the prod schema and stays isolated.
Point the staging deployment's `DATABASE_URL` at it.

> Note: the Vercel↔Neon integration creates a Neon **branch per deployment**.
> The free plan has a branch quota — delete old branches in the Neon console if a
> deploy fails with "Branch limit reached", or limit branching to Production.

## Secrets management (#28)

Secrets are **never** committed. The repo holds only `.env.example` (placeholders).

- **Local**: `.env` (gitignored).
- **Staging / Production**: stored in the platform's secrets manager —
  **Vercel Environment Variables** (encrypted at rest, scoped per environment) and
  **GitLab CI/CD Variables** (masked + protected) for pipeline-time needs. Set at
  minimum `DATABASE_URL`, `DATABASE_URL_UNPOOLED` (migrations), and `APP_ENV` per
  environment. Rotating a secret = update it in Vercel/GitLab and redeploy; no
  code change.

## TLS

Automated and enforced end to end, with no manual certs:

- **Edge**: Vercel terminates TLS with auto-provisioned, auto-renewing
  certificates for every deployment and custom domain.
- **App**: in staging/production the API refuses non-HTTPS requests
  (`x-forwarded-proto`) and sends HSTS (see #26).
- **Database**: connections to Neon use verified TLS (`src/db/connection.ts`).

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
