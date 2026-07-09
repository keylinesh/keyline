-- 0005: CLI-approved browser sessions (M4 #39, ADR-0003).
--
-- A dashboard sign-in starts as a pending session identified by a one-time
-- code (stored hashed, like tokens). An authenticated CLI approves it, which
-- records WHO the session is for; the browser's next poll claims it, and the
-- access token is minted at claim time — no plaintext token is ever at rest.

create table web_sessions (
  id            uuid        primary key default gen_random_uuid(),
  code_hash     text        not null unique,
  status        text        not null default 'pending'
                            check (status in ('pending', 'approved', 'claimed')),
  -- filled at approval:
  member_id     uuid        references members(id)    on delete cascade,
  device_id     uuid        references devices(id)    on delete cascade,
  workspace_id  uuid        references workspaces(id) on delete cascade,
  role          member_role,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  approved_at   timestamptz
);

create index web_sessions_expires_idx on web_sessions (expires_at);
