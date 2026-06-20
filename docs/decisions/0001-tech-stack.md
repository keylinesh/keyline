# ADR-0001: Full TypeScript stack

- **Status:** accepted
- **Date:** 2026-06-20
- **Deciders:** Resi

## Context

Keyline needs a CLI, a backend API, and a web dashboard, plus a shared client-side encryption library. As a small team in the planning stage, build speed, hiring simplicity, and code sharing between surfaces matter more than squeezing out maximum runtime performance.

## Decision

Use **TypeScript everywhere**:

- **CLI** — Node + TypeScript, distributed via npm (plus Homebrew / `curl | sh` wrappers later).
- **API** — Node + TypeScript, **PostgreSQL** for storage.
- **Dashboard** — React + TypeScript.
- **Crypto** — a shared `packages/crypto` library consumed by both the CLI and (within the zero-knowledge boundary) the web app.
- **Payments** — Stripe via the official Node SDK.

The repo is a single **pnpm workspaces monorepo** so types and the crypto library are shared without publishing.

## Consequences

- One language across all surfaces: fastest path for a small team, easy code/type sharing, simpler hiring.
- The crypto library can be reused client-side in both CLI and browser — but see [ADR-0002](0002-zero-knowledge-boundary.md): reusing it in the browser has zero-knowledge implications.
- CLI install requires Node present on the user's machine, which is slightly worse DX than a single static binary (Go/Rust). Mitigated by npm distribution and, later, packaged binaries.
- Node's native `crypto` (AES-256-GCM, KDFs) covers the core primitives without third-party crypto dependencies.

## Alternatives considered

- **Go CLI + Go API + TS dashboard** — best CLI install DX (single binary) and a fast API, but two languages and no crypto-library sharing with the browser.
- **Rust CLI** — strongest crypto-safety story and binary DX, but the steepest build cost for an early-stage team.
