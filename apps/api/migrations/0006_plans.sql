-- 0006: workspace plans (M5 #49).
--
-- Every workspace is on a plan; limits are enforced in the API (entitlements.ts),
-- not in the schema, so they can change without a migration. Plan changes are
-- made by the billing layer (Paddle webhooks, M5 / ADR-0004) — never by members.
--
--   solo: 1 member, 2 environments, 7-day audit history (free)
--   team: 10 members, unlimited environments + audit ($19/mo flat)
--
-- Audit retention limits what the list endpoint RETURNS; events are never
-- deleted, and chain verification always walks the full stored chain.

alter table workspaces
  add column plan text not null default 'solo'
  check (plan in ('solo', 'team'));
