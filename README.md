# Keyline

**Share `.env` files with one command. Encrypted so even we can't read them.**

> We host your secrets. We can't read them.

Keyline is a hosted, zero-knowledge secrets manager for small dev teams (2 to 10 people). Stop pasting API keys into Slack and committing `.env` files. Encryption and decryption happen **client-side**. Our servers only ever hold ciphertext.

## Why

Small teams share secrets in ways that are convenient and dangerous: keys pasted into Slack/DMs, drifting shared docs, `.env` one bad `git push` from a public leak, and no audit trail when something leaks. The "correct" alternatives feel heavy for a 3-person team. Keyline is the simple, honest one.

## How it works

Three commands. No new format to learn. If your app reads env vars today, you're done.

```sh
keyline link <project> --env prod   # bind a directory to a workspace/environment
keyline push                        # encrypt local .env -> workspace
keyline pull                        # decrypt workspace -> local .env
keyline run -- <cmd>                # inject vars into a process, no file written
```

Goal: install → link → pull in **under two minutes**.

## Zero-knowledge, honestly

- Client-side **AES-256-GCM** encryption; servers store only ciphertext, wrapped keys, metadata, and audit events.
- The workspace key is derived from a secret **you** control and never reaches our servers.
- Member access uses **envelope encryption**. The workspace key is wrapped per device. Adding or removing a member re-wraps it instead of re-encrypting everything.
- **A breach of us is not a breach of you.** This claim must stay true and publicly verifiable. See the encryption design doc (milestone M1).

Honest caveat: lost key with no recovery = unrecoverable. That's the point. Recovery is offered via any active admin device or an optional sealed recovery file you hold yourself.

## Pricing

| Plan | Price | For |
|---|---|---|
| **Solo** | $0 forever | 1 dev, ≤2 environments, full CLI + zero-knowledge, 7-day audit history |
| **Team** | $19/mo flat | ≤10 members (no per-seat), unlimited envs, per-env access, full audit, revoke/rotate |

## Repository layout

This is a pnpm TypeScript monorepo.

```
apps/
  cli/        # the keyline CLI (Node + TypeScript)
  api/        # backend API (Node + Postgres)
  web/        # dashboard (React + TypeScript)
packages/
  crypto/     # client-side encryption library (shared by cli + web)
  shared/     # shared types and utilities
api/          # Vercel serverless entry — mounts the Hono API at /api
docs/         # encryption-design, api, infra, observability, decisions/, security-review/
index.html    # landing page (self-contained)
```

## Development

Requires Node 20+ and pnpm.

```sh
pnpm install
pnpm build        # build all packages
pnpm typecheck    # type-check the workspace
pnpm lint         # lint
pnpm test         # run tests
```

## Project status

**Backend built and deployed; CLI next.** Roadmap tracked as GitLab milestones M0–M6.

- **M0 Foundations** — done (monorepo, CI, docs).
- **M1 Crypto Core** — done. `packages/crypto`: AES-256-GCM bundles, scrypt KDF, X25519 device keypairs, sealed-box envelope wrap/unwrap, admin + sealed-file recovery; known-answer + property/fuzz tests. (External security review is the launch gate, still pending — backlog #18.)
- **M2 Backend API & Data Model** — done. `apps/api` (Hono): device auth + scoped tokens, workspace/project/environment CRUD, push/pull encrypted bundles, per-environment RBAC, tamper-evident hash-chained audit log, revoke/rotate, rate-limiting/validation/security-headers/TLS, structured logs + metrics. Runs on **Neon** (Postgres) and is **live as a Vercel function** (`/api/health`). ~127 tests; CI includes a real-Postgres job.
- **M3 CLI** — next. The `keyline` CLI that drives the live API.

Docs: [encryption design](docs/encryption-design.md) · [API reference](docs/api.md) · [infra/deploy](docs/infra.md) · [observability](docs/observability.md) · [ADRs](docs/decisions/) · [security review packet](docs/security-review/). Full positioning + risk list in `keyline-context.md`.

## License

TBD.
