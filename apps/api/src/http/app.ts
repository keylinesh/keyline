/**
 * App composition root.
 *
 * createApp(deps) builds the Hono app from injected services/repos, so tests use
 * in-memory implementations and production uses pg-backed ones (see index.ts).
 * All errors funnel through one handler that emits the standard envelope.
 */

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type { DeviceLoginService, DeviceRepo } from "../auth/device-login.js";
import type { TokenService } from "../auth/tokens.js";
import { type AppEnv, authMiddleware } from "./authz.js";
import { ApiError } from "./errors.js";
import { ipKey, rateLimit, tokenOrIpKey } from "./middleware/rate-limit.js";
import { requireHttps } from "./middleware/tls.js";
import { observability } from "./middleware/observability.js";
import { Logger, logger as defaultLogger, reportError } from "../observability/logger.js";
import { Metrics, metrics as defaultMetrics } from "../observability/metrics.js";
import type { ResourceDeps } from "./routes/resources.js";
import type { BundleDeps } from "./routes/bundles.js";
import type { MemberRouteDeps } from "./routes/members.js";
import type { AuditRouteDeps } from "./routes/audit.js";
import type { DeviceRouteDeps } from "./routes/devices.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerResourceRoutes } from "./routes/resources.js";
import { registerBundleRoutes } from "./routes/bundles.js";
import { registerMemberRoutes } from "./routes/members.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerOnboardingRoutes } from "./routes/onboarding.js";
import { registerDeviceRoutes } from "./routes/devices.js";
import { registerWebSessionRoutes, type WebSessionRouteDeps } from "./routes/web-sessions.js";
import { registerBillingRoutes, type BillingRouteDeps } from "./routes/billing.js";

export interface AppDeps
  extends ResourceDeps,
    BundleDeps,
    MemberRouteDeps,
    AuditRouteDeps,
    DeviceRouteDeps,
    WebSessionRouteDeps,
    BillingRouteDeps {
  tokens: TokenService;
  login: DeviceLoginService;
  devices: DeviceRepo;
}

/** Tunable hardening knobs (#26). Sensible defaults; production sets requireHttps. */
export interface AppConfig {
  /** Which deployment this is — development / staging / production (#28). */
  environment?: string;
  /** Per-token / per-IP limit across all routes. Default 300/min. */
  rateLimit?: { windowMs: number; max: number };
  /** Tighter per-IP limit on auth endpoints (brute-force guard). Default 20/min. */
  authRateLimit?: { windowMs: number; max: number };
  /** Max request body size in bytes. Default 1 MiB. */
  bodyLimitBytes?: number;
  /** Refuse non-HTTPS requests (behind a proxy that sets x-forwarded-proto). */
  requireHttps?: boolean;
  /** Structured logger (#29). Defaults to the process logger. */
  logger?: Logger;
  /** Metrics registry (#29). Defaults to the process registry. */
  metrics?: Metrics;
}

export function createApp(deps: AppDeps, config: AppConfig = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const rl = config.rateLimit ?? { windowMs: 60_000, max: 300 };
  const authRl = config.authRateLimit ?? { windowMs: 60_000, max: 20 };
  const maxBody = config.bodyLimitBytes ?? 1024 * 1024;
  const log = config.logger ?? defaultLogger;
  const metrics = config.metrics ?? defaultMetrics;

  // Observability wraps everything so it times and logs every request (incl.
  // rate-limited / denied ones).
  app.use("*", observability(log, metrics));

  // Hardening middleware runs before everything else.
  app.use("*", secureHeaders());
  if (config.requireHttps) app.use("*", requireHttps());
  app.use(
    "*",
    bodyLimit({
      maxSize: maxBody,
      onError: (c) =>
        c.json({ error: { code: "payload_too_large", message: "request body too large" } }, 413),
    }),
  );
  // Per-token-or-IP limit everywhere; a stricter per-IP limit on auth endpoints.
  app.use("*", rateLimit({ ...rl, keyFn: tokenOrIpKey }));
  app.use("/v1/auth/*", rateLimit({ ...authRl, keyFn: ipKey }));
  app.use("/v1/devices", rateLimit({ ...authRl, keyFn: ipKey }));
  app.use("/v1/join", rateLimit({ ...authRl, keyFn: ipKey }));
  // The sign-in page polls session claim every few seconds, so the strict
  // auth budget 429'd legitimate sign-ins after ~40 seconds on the page.
  // Session ids are unguessable, so claim polling gets a polling-sized
  // budget; creating sessions and magic links stays strict.
  app.use("/v1/web/sessions", rateLimit({ ...authRl, keyFn: ipKey }));
  app.use("/v1/web/sessions/*", rateLimit({ windowMs: 60_000, max: 120, keyFn: ipKey }));
  app.use("/v1/web/magic", rateLimit({ ...authRl, keyFn: ipKey }));
  app.use("/v1/web/magic/*", rateLimit({ ...authRl, keyFn: ipKey }));

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(err.body(), err.status as 400);
    // Unexpected: report with stack (error tracking), return a generic 500.
    reportError(err, { path: c.req.path, method: c.req.method }, log);
    return c.json(
      { error: { code: "internal", message: "internal server error" } },
      500,
    );
  });

  app.notFound((c) => c.json({ error: { code: "not_found", message: "not found" } }, 404));

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "keyline-api",
      environment: config.environment ?? "unknown",
      // Deployed git commit (Vercel injects VERCEL_GIT_COMMIT_SHA). Lets us
      // verify exactly which build is live without touching the database.
      version: (process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown").slice(0, 8),
      // Which storage the app resolved to. "postgres" means a DB URL was found;
      // "memory" means none was — a quick tell for env-var problems.
      storage: process.env.DATABASE_URL || process.env.POSTGRES_DATABASE_URL || process.env.POSTGRES_URL
        ? "postgres"
        : "memory",
    }),
  );

  // Prometheus metrics for scraping (aggregate, non-secret counts).
  app.get("/metrics", (c) => c.text(metrics.render(), 200, { "content-type": "text/plain; version=0.0.4" }));

  // TEMPORARY (#60 debug): probe the DB connection and return the real error.
  // Bounded by a hard 6s race so it can never hang the function like /v1/* does.
  // Shows host/db (non-secret) but never credentials. Remove once resolved.
  app.get("/debug/db", async (c) => {
    const { appDatabaseUrl } = await import("../db/database-url.js");
    const { connectionConfig } = await import("../db/connection.js");
    const { Pool } = await import("pg");
    const url = appDatabaseUrl();
    if (!url) return c.json({ resolved: false, storage: "memory" });
    let host = "unknown";
    let database = "unknown";
    try {
      const u = new URL(url);
      host = u.hostname;
      database = u.pathname.slice(1);
    } catch {
      /* non-URL DSN */
    }
    const started = Date.now();
    const pool = new Pool({ ...connectionConfig(url), connectionTimeoutMillis: 5_000, max: 1 });
    try {
      await Promise.race([
        pool.query("select 1 as ok"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("hard-timeout: no response in 6s")), 6_000),
        ),
      ]);
      return c.json({ resolved: true, host, database, ok: true, ms: Date.now() - started });
    } catch (err) {
      const e = err as { message?: string; code?: string };
      return c.json({
        resolved: true,
        host,
        database,
        ok: false,
        ms: Date.now() - started,
        error: e.message ?? String(err),
        code: e.code ?? null,
      });
    } finally {
      void pool.end().catch(() => {});
    }
  });

  const auth = authMiddleware(deps.tokens);
  registerAuthRoutes(app, deps.login, deps.join, auth);
  registerOnboardingRoutes(app, deps);
  registerResourceRoutes(app, deps, auth);
  registerMemberRoutes(app, deps, auth);
  registerBundleRoutes(app, deps, auth);
  registerDeviceRoutes(app, deps, auth);
  registerAuditRoutes(app, deps, auth);
  registerWebSessionRoutes(app, deps, auth);
  registerBillingRoutes(app, deps, auth);

  return app;
}
