/**
 * App composition root.
 *
 * createApp(deps) builds the Hono app from injected services/repos, so tests use
 * in-memory implementations and production uses pg-backed ones (see index.ts).
 * All errors funnel through one handler that emits the standard envelope.
 */

import { Hono } from "hono";
import type { DeviceLoginService } from "../auth/device-login.js";
import type { TokenService } from "../auth/tokens.js";
import { type AppEnv, authMiddleware } from "./authz.js";
import { ApiError } from "./errors.js";
import type { ResourceDeps } from "./routes/resources.js";
import type { BundleDeps } from "./routes/bundles.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerResourceRoutes } from "./routes/resources.js";
import { registerBundleRoutes } from "./routes/bundles.js";

export interface AppDeps extends ResourceDeps, BundleDeps {
  tokens: TokenService;
  login: DeviceLoginService;
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(err.body(), err.status as 400);
    // Unexpected: log server-side, return a generic 500 (no internals leaked).
    console.error("unhandled error:", err);
    return c.json(
      { error: { code: "internal", message: "internal server error" } },
      500,
    );
  });

  app.notFound((c) => c.json({ error: { code: "not_found", message: "not found" } }, 404));

  app.get("/health", (c) => c.json({ status: "ok", service: "keyline-api" }));

  const auth = authMiddleware(deps.tokens);
  registerAuthRoutes(app, deps.login);
  registerResourceRoutes(app, deps, auth);
  registerBundleRoutes(app, deps, auth);

  return app;
}
