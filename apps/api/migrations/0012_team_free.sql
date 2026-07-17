-- 0012: the Team Free tier (M7 #87).
--
-- Three plans: solo (1 member), team_free (up to 3 members, $0), team ($19
-- flat, up to 10). Limits stay in the API (entitlements.ts); this only widens
-- the allowed plan values. Cancel/pause now lands on team_free, never solo:
-- a downgraded team keeps reading its secrets, only new invites are blocked.

alter table workspaces drop constraint if exists workspaces_plan_check;
alter table workspaces
  add constraint workspaces_plan_check check (plan in ('solo', 'team_free', 'team'));
