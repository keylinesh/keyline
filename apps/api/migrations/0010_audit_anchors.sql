-- 0010: audit chain anchoring (#61).
--
-- The audit log is hash-chained (0004), which catches edits, deletes, and
-- reorders — unless an attacker with DB access rewrites EVERY later event and
-- reseals the chain. Anchoring closes that: a daily job witnesses each
-- workspace's chain head (seq + head hash) in a PUBLIC git repository, so
-- history rewrites are detectable even by us. This table is the local record
-- of what was anchored; the public witness is the proof.

create table audit_anchors (
  id            uuid        primary key default gen_random_uuid(),
  workspace_id  uuid        not null references workspaces(id) on delete cascade,
  seq           integer     not null,
  head_hash     text        not null,
  witness_url   text,
  anchored_at   timestamptz not null default now()
);

create index audit_anchors_ws_idx on audit_anchors (workspace_id, anchored_at desc);
