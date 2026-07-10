# Keyline API

The backend API (`apps/api`, built on Hono). The server stores and returns only
ciphertext, wrapped keys, public keys, salts, and metadata — never a workspace
secret, workspace key, device private key, or plaintext secret value.

Status: built across **M2** (#19–#26). Persistence runs against Postgres when
`DATABASE_URL` is set, otherwise in-memory for local dev.

## Base URL

- **Local (Node server):** `http://localhost:3000` — paths exactly as below (`/health`, `/v1/...`).
- **Deployed (Vercel, same project):** the API is served under **`/api`** (`api/[[...route]].ts`), so paths are `/api/health` and `/api/v1/...`. `DATABASE_URL` must be set in the Vercel environment, or the API runs on ephemeral in-memory storage. See [`docs/infra.md`](infra.md).

## Auth model

- A **device** proves possession of its private key (it never sends it) and
  receives a short-lived, scoped **access token**.
- Tokens are opaque strings (`klk_…`), stored server-side only as SHA-256 hashes.
- Every protected request sends `Authorization: Bearer <token>`.
- Authorization layers: the token is scoped to one **workspace** + workspace
  **role** (owner/admin/member, possibly restricted to specific environments);
  on top, each environment has **per-member roles** (`read`/`write`/`admin`).
  Owners/admins implicitly have admin on every environment; a plain member has no
  environment access until granted.

## Error format

All errors are `{ "error": { "code", "message", "details?" } }` with a matching
status. Codes: `unauthorized` (401), `forbidden` (403), `not_found` (404),
`conflict` (409), `payload_too_large` (413), `validation_error` (422),
`rate_limited` (429), `internal` (500).

## Hardening (#26)

- **Rate limits**: per token (or per IP when unauthenticated) across all routes, plus a tighter per-IP limit on `/v1/auth/*` and `/v1/devices`. Over the limit returns `429 rate_limited` with a `Retry-After` header.
- **Body size limit**: oversized requests return `413 payload_too_large`.
- **Security headers**: HSTS, `X-Frame-Options`, `X-Content-Type-Options: nosniff`, etc. (Hono `secureHeaders`).
- **TLS-only**: in production, requests not forwarded as HTTPS (`x-forwarded-proto`) are refused.

## Endpoints

### Health
- `GET /health` → `{ status, service }` (public)

### Onboarding (public)
- `POST /v1/onboard` — bootstrap a new account: creates a workspace (+ KDF salt), a first **owner** member, and registers the caller's device. Body: `{ workspaceName, kdfSalt, email, displayName?, devicePublicKey, deviceName? }` → `{ workspaceId, memberId, deviceId, publicKey }`. Open signup (invite/verification gating tracked as #64).

### Device auth (public)
- `POST /v1/devices` — register a device public key. Body: `{ memberId, workspaceId, publicKey, role, name? }` → `{ deviceId, publicKey }`. (Onboarding seam — to be gated by enrollment.)
- `POST /v1/auth/device/challenge` — Body: `{ deviceId }` → `{ challengeId, sealed }`. `sealed` is a 32-byte challenge sealed to the device public key.
- `POST /v1/auth/device/login` — Body: `{ challengeId, answer, environmentIds? }` → `{ token, expiresAt }`. `answer` is the unsealed challenge (base64).

### Workspaces
- `POST /v1/workspaces` — create. Body: `{ name, kdfSalt }`. (Onboarding seam.)
- `GET /v1/workspaces` — the token's workspace.
- `GET /v1/workspaces/:id` — read (in-scope).
- `PATCH /v1/workspaces/:id` — rename (admin). Body: `{ name }`.
- `DELETE /v1/workspaces/:id` — delete (owner).

### Projects
- `POST /v1/workspaces/:wid/projects` — create (admin). Body: `{ name, slug }`.
- `GET /v1/workspaces/:wid/projects` — list.
- `GET|PATCH|DELETE /v1/projects/:id` — read / update / delete (write = admin).

### Environments
- `POST /v1/projects/:pid/environments` — create (admin). Body: `{ name }`.
- `GET /v1/projects/:pid/environments` — list.
- `GET|PATCH|DELETE /v1/environments/:id` — read / update / delete (write = admin).

### Secret bundles (the encrypted data path)
- `PUT /v1/environments/:id/bundle` — push (env `write`). Body: `{ bundle: { v, nonce, ciphertext, tag }, baseVersion? }` → `{ version, createdAt }`. A stale `baseVersion` returns **409** with the current version (optimistic concurrency).
- `GET /v1/environments/:id/bundle` — pull (env `read`) → `{ bundle: { version, v, nonce, ciphertext, tag, createdAt }, wrappedKey }`. `wrappedKey` is the workspace key sealed to the calling device (`null` if none yet).
- `POST /v1/environments/:id/rotate` — rotate one secret (env `write`). Body: `{ bundle, baseVersion?, secretName }` → `{ version, createdAt }`. The client re-encrypts with the secret changed; the server records the secret **name** and version, never the value.

### Members & access control
- `POST /v1/workspaces/:wid/members` — invite (admin). Body: `{ email, role, displayName? }`.
- `GET /v1/workspaces/:wid/members` — list (member).
- `DELETE /v1/members/:id` — remove (admin).
- `POST /v1/members/:id/revoke` — cut access immediately (admin): revokes the member's tokens, deletes each device's wrapped key, marks devices revoked → `{ tokensRevoked, devicesRevoked, wrappedKeysDeleted }`.
- `PUT /v1/devices/:id/wrapped-key` — issue a wrapped workspace key to a device (admin, or the device's own member). Body: `{ wrappedKey: { v, eph, nonce, ct, tag } }`. The client wraps the workspace key to the device's public key; the server stores the blob so the device can decrypt on pull. The inverse of revoke; server never sees the workspace key.
- `GET /v1/devices/:id/wrapped-key` — read a device's wrapped key (same authorization) → `{ wrappedKey: {…} | null, workspaceHasKey }`. `workspaceHasKey: false` means no device in the workspace holds a key yet (fresh workspace — the CLI's first `push` generates one); `null` + `true` means this device hasn't been granted access.
- `GET /v1/members/:id/devices` — a member's devices (admin, or the member itself) → `{ devices: [{ id, publicKey, revoked, hasWrappedKey }] }`. Lets `keyline members grant` wrap the workspace key to each of the member's devices.
- `PUT /v1/environments/:id/access` — grant an env role (env admin). Body: `{ memberId, role }` where role ∈ `read|write|admin`.
- `GET /v1/environments/:id/access` — list grants (env admin).
- `DELETE /v1/environments/:id/access/:memberId` — revoke a grant (env admin).

### Web sessions (dashboard sign-in, ADR-0003)
- `POST /v1/web/sessions` — start (public) → `{ sessionId, code, expiresAt }`. The dashboard shows the code; it lives 10 minutes, stored hashed.
- `POST /v1/web/sessions/approve` — approve by code (device-authenticated; the `keyline web <code>` command). Binds the caller's member/device/workspace/role to the session. Unknown, expired, or reused codes → 404.
- `POST /v1/web/sessions/:id/claim` — poll (public) → `{ status: pending|expired|consumed }` or, exactly once after approval, `{ status: "ready", token, expiresAt, workspaceId, memberId, role }`. The 8-hour token is minted at claim time (never stored) and is bound to the approving device, so member/device revocation kills web sessions too.

All `/v1/web/*` routes sit behind the tight per-IP auth rate limit.

### Audit log
- `GET /v1/workspaces/:wid/audit` — list events (admin). Hash-chained, append-only.
- `GET /v1/workspaces/:wid/audit/verify` — verify chain integrity (admin) → `{ ok, count }` or `{ ok: false, brokenSeq, reason }`.

Recorded actions include `bundle.push`, `bundle.pull` (allowed and denied),
`secret.rotate`, `member.invite`, `member.remove`, `member.revoke`,
`access.grant`, `access.revoke`.

## Running locally

```bash
pnpm --filter @keyline/api dev        # in-memory, no DATABASE_URL needed
# with Postgres:
export DATABASE_URL=postgres://…
pnpm --filter @keyline/api db:migrate
pnpm --filter @keyline/api dev
```
