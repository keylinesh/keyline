/**
 * Postgres connection config.
 *
 * Managed Postgres (Neon) requires TLS; local Postgres usually doesn't. We
 * enable SSL with certificate verification for any non-local host, or when the
 * connection string asks for it (`sslmode=require`). Neon presents a valid
 * certificate, so verification stays on.
 */

import type { ClientConfig } from "pg";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);

export function connectionConfig(connectionString: string): ClientConfig {
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
  };
}
