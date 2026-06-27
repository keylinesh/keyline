/**
 * Resolve the Postgres connection string from the environment.
 *
 * Managed-Postgres integrations (Neon on Vercel) inject the URL under different
 * names depending on setup. We accept the common ones so deployments don't need
 * to rename variables, with DATABASE_URL taking priority.
 *
 * Migrations prefer a direct (unpooled) connection — pgBouncer pooling can break
 * multi-statement transactions and session locks.
 */

const POOLED = ["DATABASE_URL", "POSTGRES_DATABASE_URL", "POSTGRES_URL"] as const;

const UNPOOLED = [
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_DATABASE_URL_UNPOOLED",
] as const;

function firstSet(env: NodeJS.ProcessEnv, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value && value.length > 0) return value;
  }
  return undefined;
}

/** Connection string for the running app (pooled is fine). */
export function appDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return firstSet(env, POOLED);
}

/** Connection string for migrations (prefer unpooled, fall back to pooled). */
export function migrationDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return firstSet(env, [...UNPOOLED, ...POOLED]);
}
