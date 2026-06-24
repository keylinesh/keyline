-- 0003_rbac — per-environment access control.
--
-- Workspace role (members.role) sets the baseline: owner/admin implicitly have
-- admin on every environment. A plain member has NO environment access until
-- granted here (least privilege). environment_access records explicit grants.

create type environment_role as enum ('read', 'write', 'admin');

create table environment_access (
  id             uuid             primary key default gen_random_uuid(),
  environment_id uuid             not null references environments(id) on delete cascade,
  member_id      uuid             not null references members(id)      on delete cascade,
  role           environment_role not null,
  created_at     timestamptz      not null default now(),
  unique (environment_id, member_id)
);
create index environment_access_member_idx on environment_access (member_id);
