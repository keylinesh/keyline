/**
 * Thin fetch client for the keyline API, mirroring the CLI's ApiClient:
 * base URL, bearer auth, JSON, and the { error: { code, message } } envelope.
 *
 * The dashboard is metadata-only (ADR-0002): it never requests bundle
 * ciphertext and holds no key material — just this short-lived session token.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Same-origin `/api` in production; vite proxies it to a local API in dev. */
export const API_BASE: string = import.meta.env.VITE_API_URL ?? "/api";

/** Human-readable message for a failed call. */
export function explainError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return "You need admin access for that.";
    if (err.status === 409) return "That name is already taken.";
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export async function request<T>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; fetchImpl?: typeof fetch; base?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";

  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${opts.base ?? API_BASE}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, "network_error", "cannot reach the keyline API");
  }

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `request failed (${res.status})`);
  }
  return data as T;
}
