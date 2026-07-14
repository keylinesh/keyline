-- 0009: teammate join codes (#66, closes the #64 open-enrollment seam).
--
-- Inviting a member mints a one-time join code (stored hashed, like tokens
-- and web-session codes). The teammate runs `keyline join <code>`, which
-- registers their device under that membership. One active code per member;
-- regenerating replaces it. Codes expire after 7 days and burn on use.

create table member_join_codes (
  member_id   uuid        primary key references members(id) on delete cascade,
  code_hash   text        not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
