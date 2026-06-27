/**
 * Vercel serverless entry for the keyline API.
 *
 * Catch-all under `/api/*`: the Hono app is mounted at `/api`, so endpoints are
 * served at `/api/health` and `/api/v1/...`. Uses the Node runtime (Postgres +
 * node:crypto). Configuration (DATABASE_URL, NODE_ENV) comes from Vercel env.
 *
 * The more specific `api/waitlist.ts` keeps handling `/api/waitlist`.
 */

import { Hono } from "hono";
import { handle } from "hono/vercel";
import { buildApp } from "@keyline/api/app";

export const config = { runtime: "nodejs" };

const root = new Hono();
root.route("/api", buildApp());

export default handle(root);
