# ADR-0003: Web dashboard sign-in via CLI-approved sessions

- **Status:** accepted
- **Date:** 2026-07-09
- **Deciders:** Resi

## Context

The dashboard (M4) is metadata-only (ADR-0002), but it still needs a session
against the API. The API has no passwords by design: the only principal is a
device proving possession of its X25519 key. A browser doesn't hold one, and
we don't want it to (issuing keys to browsers is the slope ADR-0002 avoids).

## Decision

**Device-flow style, approved from the CLI.** The dashboard shows a short
one-time code. An already-authenticated CLI runs `keyline web <code>`, which
tells the API to bind a fresh, short-lived, metadata-scoped token to that
browser session. The browser polls and picks the token up once.

Email magic links for non-terminal users are deliberately deferred
(backlog #68): they need an email provider and make email an auth root.

## Consequences

- No new infrastructure: no passwords, no email service, no browser crypto.
- The existing device is the root of trust for the web too; revoking a member
  kills their web sessions with their tokens.
- Only CLI-enrolled users can open the dashboard for now. True today anyway;
  #68 (magic links) and #66 (join flow) lift this when needed.
- New API surface: web session start/poll/approve. Codes are single-use,
  short-TTL, rate-limited; the token is released to the poller exactly once.

## Alternatives considered

- **Email magic links now** — external provider + cost + deliverability, and
  email compromise would open metadata sessions. Deferred, not rejected (#68).

## Addendum (2026-07-14, #68 shipped)

Magic links exist now, scoped tighter than originally feared: only members
with at least one ACTIVE device can request one, and the minted 8h session is
bound to that device, so member/device revocation kills magic sessions like
CLI-approved ones. Enrollment stays join-code-only (#66); email is a re-entry
factor, never a root for new access. Requests never reveal whether an email
exists. Links are hashed at rest, single-use, 15-minute.
- **Browser as a device (X25519 in the browser)** — needs browser crypto +
  key storage, and normalizes browsers holding device keys; rejected for v1.
- **Password accounts** — a second auth system to secure and audit; rejected.
