/**
 * Vercel serverless entry for the keyline API (Node runtime).
 *
 * Catch-all under `/api/*`: the Hono app is mounted at `/api`, so endpoints are
 * served at `/api/health` and `/api/v1/...`.
 *
 * Everything is loaded with dynamic `import()`. Vercel compiles this function as
 * CommonJS, and the `@keyline/api` build is ESM-only — a static import compiles
 * to `require()` of an ES module and crashes with ERR_REQUIRE_ESM. Dynamic
 * `import()` loads ESM from a CJS module fine, and the app is built once and
 * cached across warm invocations.
 *
 * The more specific `api/waitlist.ts` keeps handling `/api/waitlist`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export const config = { runtime: "nodejs" };

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => unknown;

let cached: NodeHandler | undefined;

let flushTracking: (() => Promise<void>) | undefined;

async function getHandler(): Promise<NodeHandler> {
  if (cached) return cached;
  const [{ Hono }, { handle }, { buildApp }, { initSentry, flushSentry }] = await Promise.all([
    import("hono"),
    import("@hono/node-server/vercel"),
    import("@keyline/api/app"),
    import("@keyline/api/sentry"),
  ]);
  initSentry(); // dormant unless SENTRY_DSN is set
  flushTracking = flushSentry;
  const root = new Hono();
  root.route("/api", buildApp());
  cached = handle(root) as unknown as NodeHandler;
  return cached;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // TEMPORARY diagnostic: report what Vercel hands us for a POST body, without
  // touching the Hono app. Confirms the rawBody reconstruction below. Remove later.
  if ((req.url ?? "").includes("__echo")) {
    const d = req as IncomingMessage & { body?: unknown; rawBody?: unknown };
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        method: req.method,
        url: req.url,
        hasBody: d.body !== undefined,
        bodyType: typeof d.body,
        hasRawBody: Buffer.isBuffer(d.rawBody),
      }),
    );
    return;
  }

  const h = await getHandler();
  // Vercel's Node HELPERS parse the JSON body and CONSUME the request stream.
  // @hono/node-server/vercel then falls back to re-reading that (already ended)
  // stream, so `c.req.json()` awaits data that never comes and every POST hangs
  // to a FUNCTION_INVOCATION_TIMEOUT.
  //
  // The project sets NODEJS_HELPERS=0, which disables that parsing: the stream
  // stays raw, the adapter reads it normally, and — critically — the Paddle
  // webhook (#73) verifies its HMAC over the TRUE wire bytes. Reconstructed
  // JSON (below) is byte-identical only by luck, so the env var is required
  // for billing. The fallback keeps every other POST working if the helpers
  // are ever on again: re-attach the parsed body as `rawBody` (a Buffer),
  // which the adapter uses instead of the dead stream.
  const r = req as IncomingMessage & { body?: unknown; rawBody?: Buffer };
  if (r.body !== undefined && !(r.rawBody instanceof Buffer)) {
    r.rawBody = Buffer.isBuffer(r.body)
      ? r.body
      : typeof r.body === "string"
        ? Buffer.from(r.body)
        : Buffer.from(JSON.stringify(r.body));
  }
  try {
    await h(req, res);
  } finally {
    // Serverless freezes between invocations; flush queued events first so a
    // captured error isn't stranded. No-op when tracking is off.
    await flushTracking?.();
  }
}
