/**
 * Beta first-run funnel (#57) — how far new workspaces actually get, straight
 * from data we already hold (metadata + audit events; no tracking added).
 *
 * Run with:  DATABASE_URL=... pnpm --filter @keyline/api beta:metrics
 *
 * The funnel a healthy first run walks:
 *   workspace created -> first push (the aha moment) -> second member joined
 *   -> teammate pulled -> still active in the last 7 days
 */

import { Pool } from "pg";
import { connectionConfig } from "../src/db/connection.js";
import { appDatabaseUrl } from "../src/db/database-url.js";

const dbUrl = appDatabaseUrl();
if (!dbUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const pool = new Pool(connectionConfig(dbUrl));

interface FunnelRow {
  name: string;
  plan: string;
  created: string;
  first_push_hours: string | null;
  members: string;
  joined_members: string;
  teammate_pulled: boolean;
  active_7d: boolean;
}

const { rows } = await pool.query<FunnelRow>(`
  with first_push as (
    select p.workspace_id, min(b.created_at) as at
    from secret_bundles b
    join environments e on e.id = b.environment_id
    join projects p on p.id = e.project_id
    group by p.workspace_id
  ),
  member_stats as (
    select m.workspace_id,
           count(*) as members,
           count(*) filter (where exists (
             select 1 from devices d
             where d.member_id = m.id and d.revoked_at is null
           )) as joined
    from members m
    group by m.workspace_id
  ),
  teammate_pull as (
    select a.workspace_id
    from audit_events a
    where a.action = 'bundle.pull'
      and a.actor_member_id <> (
        select m2.id::text from members m2
        where m2.workspace_id = a.workspace_id
        order by m2.created_at asc limit 1
      )
    group by a.workspace_id
  ),
  activity as (
    select workspace_id, max(created_at) as last_at
    from audit_events group by workspace_id
  )
  select w.name,
         w.plan,
         to_char(w.created_at, 'YYYY-MM-DD') as created,
         round(extract(epoch from fp.at - w.created_at) / 3600, 1)::text as first_push_hours,
         coalesce(ms.members, 0)::text as members,
         coalesce(ms.joined, 0)::text as joined_members,
         tp.workspace_id is not null as teammate_pulled,
         coalesce(ac.last_at > now() - interval '7 days', false) as active_7d
  from workspaces w
  left join first_push fp on fp.workspace_id = w.id
  left join member_stats ms on ms.workspace_id = w.id
  left join teammate_pull tp on tp.workspace_id = w.id
  left join activity ac on ac.workspace_id = w.id
  order by w.created_at desc
`);

console.table(rows);

const total = rows.length;
const pushed = rows.filter((r) => r.first_push_hours !== null).length;
const day1 = rows.filter((r) => r.first_push_hours !== null && Number(r.first_push_hours) <= 24).length;
const team = rows.filter((r) => Number(r.joined_members) >= 2).length;
const shared = rows.filter((r) => r.teammate_pulled).length;
const active = rows.filter((r) => r.active_7d).length;
const pct = (n: number) => (total ? `${n}/${total} (${Math.round((100 * n) / total)}%)` : "0/0");

console.log(`workspaces:            ${total}`);
console.log(`reached first push:    ${pct(pushed)}   <- the aha moment`);
console.log(`pushed within 24h:     ${pct(day1)}   <- first-run success`);
console.log(`second member joined:  ${pct(team)}`);
console.log(`teammate pulled:       ${pct(shared)}   <- the product promise`);
console.log(`active last 7 days:    ${pct(active)}`);

const { rows: wl } = await pool.query(
  `select count(*)::int as n, max(created_at) as latest from waitlist`,
);
console.log(`\nwaitlist signups:      ${wl[0].n} (latest ${wl[0].latest?.toISOString().slice(0, 10) ?? "never"})`);

await pool.end();
