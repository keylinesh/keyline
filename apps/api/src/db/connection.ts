/**
 * Postgres connection config.
 *
 * Managed Postgres (Neon) requires TLS; local Postgres usually doesn't. We
 * enable SSL with certificate verification for any non-local host, or when the
 * connection string asks for it (`sslmode=require`). Neon presents a valid
 * certificate, so verification stays on.
 */

import type { PoolConfig } from "pg";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);

export function connectionConfig(connectionString: string): PoolConfig {
  let host = "";
  let sslmode: string | null = null;
  try {
    const url = new URL(connectionString);
    host = url.hostname;
    sslmode = url.searchParams.get("sslmode");
  } catch {
    // Non-URL DSNs fall back to SSL-on (safer for managed hosts).
  }
  const wantsSsl = sslmode === "require" || !LOCAL_HOSTS.has(host);
  return {
    connectionString,
    ssl: sslmode === "disable" ? false : wantsSsl ? { rejectUnauthorized: true } : false,
    // Serverless safety: an unreachable/misconfigured DB must fail fast and
    // surface the error, never hang the function. Without these, a bad
    // connection blocks until the platform kills the invocation (no log, no
    // 5xx — just a timeout the caller sees as a dead endpoint).
    connectionTimeoutMillis: 8_000,
    statement_timeout: 10_000,
    query_timeout: 10_000,
    idleTimeoutMillis: 10_000,
  };
}
