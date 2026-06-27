/**
 * Request logging + metrics middleware (#29).
 *
 * Times each request, records a metric, and emits one structured log line with
 * the method, path, matched route, status, duration, a request id, and the actor
 * ids (member/device) when authenticated. It never logs the body or the
 * Authorization header — only non-secret metadata.
 */

import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { Principal } from "../../auth/tokens.js";
import type { Logger } from "../../observability/logger.js";
import type { Metrics } from "../../observability/metrics.js";
import type { AppEnv } from "../authz.js";

export function observability(logger: Logger, metrics: Metrics): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const start = performance.now();
    const requestId = c.req.header("x-vercel-id") ?? randomUUID();

    await next();

    const ms = performance.now() - start;
    const route = c.req.routePath ?? c.req.path;
    const status = c.res.status;
    metrics.observe(c.req.method, route, status, ms);

    const principal = c.get("principal") as Principal | undefined;
    logger.info("request", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      route,
      status,
      ms: Math.round(ms),
      memberId: principal?.memberId,
      deviceId: principal?.deviceId,
      workspaceId: principal?.scope.workspaceId,
    });
  };
}
