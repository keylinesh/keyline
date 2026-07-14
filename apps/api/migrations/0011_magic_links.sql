-- 0011: email magic-link sign-in (#68).
--
-- A metadata-only RE-ENTRY path for the dashboard: a member with at least one
-- enrolled device can request a sign-in link by email. Tokens are stored
-- hashed, live 15 minutes, and burn on use. The minted browser session is
-- bound to the member's device like a CLI-approved one, so member/device
-- revocation kills magic sessions too. Enrollment stays join-code-only; a
-- compromised inbox can never reach secret values (dashboard is metadata-only
-- by ADR-0002).

create table magic_links (
  id          uuid        primary key default gen_random_uuid(),
  member_id   uuid        not null references members(id) on delete cascade,
  token_hash  text        not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
