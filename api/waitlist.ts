/**
 * POST /api/waitlist  — stores a waitlist signup in Vercel Postgres.
 *
 * Setup (one-time): in the Vercel dashboard, create a Postgres (Neon) store and
 * connect it to this project. Vercel injects the connection env vars
 * (POSTGRES_URL etc.) automatically — @vercel/postgres reads them with no config.
 *
 * Note: @vercel/postgres is deprecated in favor of @neondatabase/serverless; it
 * still works. Migrate later if desired — the SQL below is portable.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "@vercel/postgres";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const email = String(req.body?.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ error: "invalid_email" });
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
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("waitlist error:", err);
    return res.status(500).json({ error: "server_error" });
  }
}
