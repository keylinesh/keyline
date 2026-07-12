/**
 * App builder — constructs the configured Hono app from the environment without
 * listening. Used by the Node server (index.ts) and by the Vercel serverless
 * function (root `api/[[...route]].ts`).
 *
 * Uses Postgres when DATABASE_URL is set, otherwise in-memory repos.
 */

import { Pool } from "pg";
import { createPool as createVercelPool } from "@vercel/postgres";
import type { Hono } from "hono";
import { connectionConfig } from "./db/connection.js";
import { appDatabaseUrl } from "./db/database-url.js";
import { memoryDeps, pgDeps } from "./deps.js";
import { type AppConfig, type AppDeps, createApp } from "./http/app.js";
import type { AppEnv } from "./http/authz.js";

/**
 * Build the app's connection pool.
 *
 * On Vercel serverless, a long-lived `pg.Pool` is a trap: the runtime freezes
 * the function between invocations, which silently kills the pool's idle TCP
 * sockets. The next request gets handed a dead connection and the query hangs
 * on a black-holed socket until the platform times out the whole invocation
 * (observed: /v1/* → 504 FUNCTION_INVOCATION_TIMEOUT, with no query ever
 * reaching Postgres). @vercel/postgres (Neon serverless) manages connections
 * per-invocation and is freeze-safe, so we use it in the serverless runtime.
 * Everywhere else (local dev, migrations, *.pg.test.ts) keeps plain `pg`.
 */
function buildPool(databaseUrl: string): Pool {
  if (process.env.VERCEL) {
    return createVercelPool({ connectionString: databaseUrl }) as unknown as Pool;
  }
  return new Pool(connectionConfig(databaseUrl));
}

export type Environment = "development" | "staging" | "production";

/**
 * Resolve the deployment environment + derived config from the process env.
 * APP_ENV is authoritative; otherwise fall back to NODE_ENV. HTTPS is enforced
 * everywhere except local development (#28).
 */
export function resolveRuntimeConfig(env: NodeJS.ProcessEnv = process.env): {
  environment: Environment;
  requireHttps: boolean;
} {
  const raw = (env.APP_ENV ?? env.NODE_ENV ?? "development").toLowerCase();
  const environment: Environment =
    raw === "production" || raw === "prod"
      ? "production"
      : raw === "staging" || raw === "stage"
        ? "staging"
        : "development";
  return { environment, requireHttps: environment !== "development" };
}

export function buildApp(deps?: AppDeps): Hono<AppEnv> {
  const databaseUrl = appDatabaseUrl();
  const resolved = deps ?? (databaseUrl ? pgDeps(buildPool(databaseUrl)) : memoryDeps());
  const { environment, requireHttps } = resolveRuntimeConfig();
  const config: AppConfig = { environment, requireHttps };
  return createApp(resolved, config);
}

export function storageLabel(): string {
  return appDatabaseUrl() ? "postgres" : "in-memory (no database url)";
}

// Re-exported so out-of-package tests (the CLI harness) can build an app around
// deps they hold a reference to — e.g. to put a test workspace on the team plan.
export { memoryDeps };
export type { AppDeps };
