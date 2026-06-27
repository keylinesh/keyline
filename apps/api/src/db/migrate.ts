/**
 * Migration runner.
 *
 * Applies any pending SQL migrations in order, each in its own transaction, and
 * records applied names in `schema_migrations`. Idempotent: re-running applies
 * only what is new. Connects via DATABASE_URL (any Postgres host).
 *
 * Run with:  pnpm --filter @keyline/api db:migrate
 */

import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { connectionConfig } from "./connection.js";
import { migrationDatabaseUrl } from "./database-url.js";
import { loadMigrations } from "./migrations.js";

export async function migrate(
  databaseUrl: string | undefined = migrationDatabaseUrl(),
): Promise<{ applied: string[] }> {
  if (!databaseUrl) {
    throw new Error(
      "No database URL found (DATABASE_URL / DATABASE_URL_UNPOOLED / POSTGRES_URL_NON_POOLING / POSTGRES_DATABASE_URL)",
    );
  }

  const client = new Client(connectionConfig(databaseUrl));
  await client.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        name       text        primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const existing = await client.query<{ name: string }>(
      "select name from schema_migrations",
    );
    const done = new Set(existing.rows.map((r) => r.name));
    const pending = loadMigrations().filter((m) => !done.has(m.name));

    if (pending.length === 0) {
      console.log("migrations: up to date");
      return { applied: [] };
    }

    const applied: string[] = [];
    for (const m of pending) {
      console.log(`migrations: applying ${m.name}`);
      await client.query("begin");
      try {
        await client.query(m.sql);
        await client.query("insert into schema_migrations(name) values ($1)", [m.name]);
        await client.query("commit");
        applied.push(m.name);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`migration ${m.name} failed: ${(err as Error).message}`, {
          cause: err,
        });
      }
    }
    console.log(`migrations: applied ${applied.length}`);
    return { applied };
  } finally {
    await client.end();
  }
}

// Run directly: `tsx src/db/migrate.ts` or `node dist/db/migrate.js`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
