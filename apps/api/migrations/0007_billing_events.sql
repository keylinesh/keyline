-- 0007: billing webhook events (M5 #73).
--
-- Every Paddle webhook is recorded once, keyed by Paddle's event id. The
-- unique constraint IS the idempotency: a retried delivery inserts nothing
-- and is acked without re-applying. Payloads are kept whole for
-- reconciliation (#77).

create table billing_events (
  id               uuid        primary key default gen_random_uuid(),
  paddle_event_id  text        not null unique,
  event_type       text        not null,
  workspace_id     uuid,
  payload          jsonb       not null,
  received_at      timestamptz not null default now()
);

create index billing_events_workspace_idx on billing_events (workspace_id, received_at);
