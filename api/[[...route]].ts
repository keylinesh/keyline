/**
 * Vercel serverless entry for the keyline API (Node runtime).
 *
 * Catch-all under `/api/*`: the Hono app is mounted at `/api`, so endpoints are
 * served at `/api/health` and `/api/v1/...`. We use the **Node** runtime (for
 * Postgres + node:crypto), so the handler comes from `@hono/node-server/vercel`
 * (bridges Node req/res), NOT `hono/vercel` (which targets the Edge runtime).
 *
 * Config (DATABASE_URL, APP_ENV) comes from Vercel env. The more specific
 * `api/waitlist.ts` keeps handling `/api/waitlist`.
 */

import { Hono } from "hono";
import { handle } from "@hono/node-server/vercel";
import { buildApp } from "@keyline/api/app";

export const config = { runtime: "nodejs" };

const root = new Hono();
root.route("/api", buildApp());

export default handle(root);
