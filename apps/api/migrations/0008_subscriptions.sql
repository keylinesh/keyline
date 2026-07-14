-- 0008: subscription state (M5 #74).
--
-- One row per workspace with a Paddle subscription, upserted from webhook
-- events. The lifecycle is explicit: trialing -> active -> past_due (grace:
-- plan stays team while Paddle retries payment) -> canceled (downgrade).
-- paused also downgrades: the customer chose to stop paying.
-- occurred_at guards out-of-order webhook delivery. customer_id is kept for
-- the customer portal (#72).

create table workspace_subscriptions (
  workspace_id            uuid        primary key references workspaces(id) on delete cascade,
  paddle_subscription_id  text        not null,
  paddle_customer_id      text,
  status                  text        not null
                          check (status in ('trialing', 'active', 'past_due', 'paused', 'canceled')),
  current_period_end      timestamptz,
  past_due_since          timestamptz,
  occurred_at             timestamptz not null,
  updated_at              timestamptz not null default now()
);
