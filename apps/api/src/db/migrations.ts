/**
 * Migration loading (pure, no database).
 *
 * Migrations are plain `.sql` files in apps/api/migrations, named with a
 * zero-padded numeric prefix (`0001_init.sql`) so lexicographic sort == apply
 * order. Kept separate from the runner so it can be unit-tested without Postgres.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface Migration {
  /** File name, e.g. "0001_init.sql". Doubles as the applied-migrations key. */
  name: string;
  /** Raw SQL to execute. */
  sql: string;
}

/** apps/api/migrations, resolved relative to this module (works from src and dist). */
export const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "migrations",
);

/** Load all migrations in apply order. */
export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}
