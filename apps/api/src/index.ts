/**
 * keyline API — Node entrypoint (long-running server).
 *
 * Builds the configured Hono app (see server.ts) and serves it. The same app is
 * deployed as a Vercel serverless function via root `api/[[...route]].ts`.
 *
 * INVARIANT: the server must never receive or store plaintext secrets or the
 * workspace master key — only ciphertext, wrapped keys, metadata, audit events.
 */

import { serve } from "@hono/node-server";
import { buildApp, resolveRuntimeConfig, storageLabel } from "./server.js";

const PORT = Number(process.env.PORT ?? 3000);
const { environment } = resolveRuntimeConfig();

serve({ fetch: buildApp().fetch, port: PORT }, () => {
  console.log(`keyline-api [${environment}] listening on :${PORT} — storage: ${storageLabel()}`);
});
