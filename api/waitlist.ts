/**
 * POST /api/waitlist  — stores a waitlist signup in Vercel Postgres.
 *
 * Setup (one-time): in the Vercel dashboard, create a Postgres (Neon) store and
 * connect it to this project. Vercel injects the connection env vars
 * (POSTGRES_URL etc.) automatically — @vercel/postgres reads them with no config.
 *
 * Helper-free on purpose: the project sets NODEJS_HELPERS=0 so request streams
 * keep their raw bytes (Paddle webhook signatures need them, see
 * [[...route]].ts). This handler reads its own body and still works if the
 * helpers happen to be on.
 *
 * Note: @vercel/postgres is deprecated in favor of @neondatabase/serverless; it
 * still works. Migrate later if desired — the SQL below is portable.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "@vercel/postgres";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readJsonBody(req: VercelRequest): Promise<unknown> {
  if (req.body !== undefined) return req.body; // helpers on: already parsed
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

function json(res: VercelResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "method_not_allowed" });
  }

  const body = (await readJsonBody(req)) as { email?: unknown } | undefined;
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json(res, 400, { error: "invalid_email" });
  }

  try {
    // Idempotent so there's no manual migration step to make this work.
    await sql`CREATE TABLE IF NOT EXISTS waitlist (
      id         BIGSERIAL PRIMARY KEY,
      email      TEXT UNIQUE NOT NULL,
      source     TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`INSERT INTO waitlist (email, source)
      VALUES (${email}, ${"landing"})
      ON CONFLICT (email) DO NOTHING`;
    return json(res, 200, { ok: true });
  } catch (err) {
    console.error("waitlist error:", err);
    return json(res, 500, { error: "server_error" });
  }
}
