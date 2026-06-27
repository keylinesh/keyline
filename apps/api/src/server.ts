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

export function buildApp(): Hono<AppEnv> {
  const databaseUrl = process.env.DATABASE_URL;
  const deps = databaseUrl ? pgDeps(new Pool(connectionConfig(databaseUrl))) : memoryDeps();
  const config: AppConfig = {
    requireHttps: process.env.NODE_ENV === "production",
  };
  return createApp(deps, config);
}

export function storageLabel(): string {
  return process.env.DATABASE_URL ? "postgres" : "in-memory (no DATABASE_URL)";
}
