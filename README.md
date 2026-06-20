# Keyline

**Share `.env` files securely with one command — encrypted so completely that not even Keyline can read your keys.**

> We host your secrets. We can't read them.

Keyline is a hosted, zero-knowledge secrets manager for small dev teams (2–10 people). Stop pasting API keys into Slack and committing `.env` files. Encryption and decryption happen **client-side** — our servers only ever hold ciphertext.

## Why

Small teams share secrets in ways that are convenient and dangerous: keys pasted into Slack/DMs, drifting shared docs, `.env` one bad `git push` from a public leak, and no audit trail when something leaks. The "correct" alternatives feel heavy for a 3-person team. Keyline is the simple, honest one.

## How it works

Three commands. No new format to learn — if your app reads env vars today, you're done.

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
- Member access uses **envelope encryption** — the workspace key is wrapped per device, so adding/revoking a member re-wraps rather than re-encrypting everything.
- **A breach of us is not a breach of you.** This claim must stay true and publicly verifiable — see the encryption design doc (tracked in milestone M1).

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
docs/
  decisions/  # architecture decision records (ADRs)
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

**Planning / early build.** The roadmap is tracked as GitLab milestones M0–M6 (run `setup-gitlab-issues.sh` to create the backlog). The riskiest assumption — the zero-knowledge crypto core — is M1 and is being built first. See `keyline-context.md` for full positioning, competitive analysis, and the honest risk list.

## License

TBD.
