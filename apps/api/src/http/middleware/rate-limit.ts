/**
 * Fixed-window rate limiting (#26).
 *
 * Keyed per token when authenticated (Bearer …) and per client IP otherwise, so
 * a single token or a single IP can be throttled independently. The default
 * store is in-memory (per instance); the Store interface lets a shared backend
 * (e.g. Redis) drop in for multi-instance deploys later.
 */

import type { Context, MiddlewareHandler } from "hono";

export interface RateLimitStore {
  /** Record a hit for `key` in the current window and return the running count. */
  hit(key: string, windowMs: number, now: number): { count: number; resetAt: number };
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  hit(key: string, windowMs: number, now: number): { count: number; resetAt: number } {
    let bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count++;
    if (this.buckets.size > 10_000) this.sweep(now);
    return { count: bucket.count, resetAt: bucket.resetAt };
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
  }
}

/** First hop in X-Forwarded-For (set by the proxy/CDN), else a placeholder. */
export function clientIp(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Key by Bearer token when present, otherwise by client IP. */
export function tokenOrIpKey(c: Context): string {
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer ")) return `tok:${auth.slice("Bearer ".length).trim()}`;
  return `ip:${clientIp(c)}`;
}

/** Key by client IP only (used for auth endpoints, before a token exists). */
export function ipKey(c: Context): string {
  return `ip:${clientIp(c)}`;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyFn: (c: Context) => string;
  store?: RateLimitStore;
  now?: () => number;
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const store = opts.store ?? new MemoryRateLimitStore();
  const now = opts.now ?? (() => Date.now());
  return async (c, next) => {
    const { count, resetAt } = store.hit(opts.keyFn(c), opts.windowMs, now());
    c.header("RateLimit-Limit", String(opts.max));
    c.header("RateLimit-Remaining", String(Math.max(0, opts.max - count)));
    if (count > opts.max) {
      c.header("Retry-After", String(Math.max(1, Math.ceil((resetAt - now()) / 1000))));
      return c.json(
        { error: { code: "rate_limited", message: "too many requests" } },
        429,
      );
    }
    await next();
  };
}
