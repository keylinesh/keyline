/**
 * App builder — constructs the configured Hono app from the environment without
 * listening. Used by the Node server (index.ts) and by the Vercel serverless
 * function (root `api/[[...route]].ts`).
 *
 * Uses Postgres when DATABASE_URL is set, otherwise in-memory repos.
 */

import { Pool } from "pg";
import type { Hono } from "hono";
import { connectionConfig } from "./db/connection.js";
import { memoryDeps, pgDeps } from "./deps.js";
import { type AppConfig, createApp } from "./http/app.js";
import type { AppEnv } from "./http/authz.js";

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

export function buildApp(): Hono<AppEnv> {
  const databaseUrl = process.env.DATABASE_URL;
  const deps = databaseUrl ? pgDeps(new Pool(connectionConfig(databaseUrl))) : memoryDeps();
  const { environment, requireHttps } = resolveRuntimeConfig();
  const config: AppConfig = { environment, requireHttps };
  return createApp(deps, config);
}

export function storageLabel(): string {
  return process.env.DATABASE_URL ? "postgres" : "in-memory (no DATABASE_URL)";
}
