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

async function getHandler(): Promise<NodeHandler> {
  if (cached) return cached;
  const [{ Hono }, { handle }, { buildApp }] = await Promise.all([
    import("hono"),
    import("@hono/node-server/vercel"),
    import("@keyline/api/app"),
  ]);
  const root = new Hono();
  root.route("/api", buildApp());
  cached = handle(root) as unknown as NodeHandler;
  return cached;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const h = await getHandler();
  return h(req, res);
}
