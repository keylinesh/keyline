-- 0004_audit — tamper-evident, append-only audit log.
--
-- Each event is hash-chained to the previous one in its workspace: hash =
-- SHA-256(canonical(event fields ‖ prev_hash)). Altering or deleting any event
-- breaks every hash after it, so tampering is detectable (see audit.ts).
--
-- Actor / target ids are stored as plain text (NOT foreign keys) on purpose: the
-- log is immutable, so a later member/device deletion must never mutate a stored
-- event and silently break the chain.

create type audit_outcome as enum ('allowed', 'denied');

create table audit_events (
  id              uuid          primary key default gen_random_uuid(),
  workspace_id    uuid          not null references workspaces(id) on delete cascade,
  seq             bigint        not null,            -- 1-based, monotonic per workspace
  actor_member_id text,
  actor_device_id text,
  action          text          not null,            -- e.g. bundle.push, member.invite
  target_type     text,
  target_id       text,
  outcome         audit_outcome not null,
  metadata        jsonb         not null default '{}'::jsonb,
  prev_hash       text          not null,            -- hash of seq-1 (or genesis)
  hash            text          not null,            -- hash of this event
  created_at      timestamptz   not null,            -- set explicitly; part of the hash
  unique (workspace_id, seq),
  unique (workspace_id, hash)
);
create index audit_events_ws_seq_idx on audit_events (workspace_id, seq);
