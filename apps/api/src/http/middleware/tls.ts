/**
 * TLS-only enforcement (#26).
 *
 * Behind a proxy/CDN (Vercel) the edge terminates TLS and forwards the original
 * scheme in X-Forwarded-Proto. When enabled, any request that arrived over plain
 * HTTP is refused. Combined with the Strict-Transport-Security header (set by
 * secureHeaders), this keeps the API HTTPS-only in production. Local dev (no
 * proxy header) is unaffected.
 */

import type { MiddlewareHandler } from "hono";

export function requireHttps(): MiddlewareHandler {
  return async (c, next) => {
    const proto = c.req.header("x-forwarded-proto");
    if (proto && proto.split(",")[0]?.trim() !== "https") {
      return c.json(
        { error: { code: "forbidden", message: "HTTPS is required" } },
        403,
      );
    }
    await next();
  };
}
