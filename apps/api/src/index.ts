/**
 * keyline API — entrypoint.
 *
 * Builds the Hono app (auth + resource CRUD; push/pull, RBAC, audit, Stripe land
 * across M2/M5) and serves it. Uses Postgres when DATABASE_URL is set, otherwise
 * in-memory repos for local dev.
 *
 * INVARIANT: the server must never receive or store plaintext secrets or the
 * workspace master key — only ciphertext, wrapped keys, metadata, audit events.
 */

import { serve } from "@hono/node-server";
import { Pool } from "pg";
import { createApp } from "./http/app.js";
import { memoryDeps, pgDeps } from "./deps.js";

const PORT = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;

const deps = databaseUrl ? pgDeps(new Pool({ connectionString: databaseUrl })) : memoryDeps();
const app = createApp(deps);

serve({ fetch: app.fetch, port: PORT }, () => {
  const backend = databaseUrl ? "postgres" : "in-memory (no DATABASE_URL)";
  console.log(`keyline-api listening on :${PORT} — storage: ${backend}`);
});
