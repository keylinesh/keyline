/**
 * Thin client for the keyline API (the M2 backend).
 *
 * Handles base URL, bearer auth, JSON encoding, and turning the API's error
 * envelope ({ error: { code, message, details } }) into a typed ApiError. The
 * fetch implementation is injectable for tests.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    // Follow redirects ourselves. fetch's automatic follow strips the
    // Authorization header on any cross-origin hop (per spec), which turned an
    // apex→www 308 into a baffling 401 "session expired". We re-attach auth
    // only when the host differs by a www. prefix; anything else fails loudly.
    let url = `${this.baseUrl}${path}`;
    let res: Response;
    for (let hop = 0; ; hop++) {
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          redirect: "manual",
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (cause) {
        throw new ApiError(0, "network_error", `cannot reach ${this.baseUrl}`, cause);
      }
      if (![301, 302, 307, 308].includes(res.status)) break;
      const location = res.headers.get("location");
      if (!location || hop >= 2) {
        throw new ApiError(0, "redirect_error", `too many redirects at ${url}`);
      }
      const target = new URL(location, url);
      if (!sameSiteHost(new URL(url).host, target.host)) {
        throw new ApiError(
          0,
          "redirect_error",
          `the API redirected to ${target.host}. Set KEYLINE_API_URL to the right address.`,
        );
      }
      url = target.toString();
    }

    const text = await res.text();
    const data = text ? safeJson(text) : undefined;
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string; details?: unknown } })?.error;
      throw new ApiError(
        res.status,
        err?.code ?? "http_error",
        err?.message ?? (res.statusText || `request failed (${res.status})`),
        err?.details,
      );
    }
    return data as T;
  }

  get<T = unknown>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }
  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }
  put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }
  patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }
  delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  health(): Promise<{ status: string; service: string; environment: string }> {
    return this.get("/health");
  }
}

/** Same host up to a leading "www." — the only redirect worth trusting with auth. */
export function sameSiteHost(a: string, b: string): boolean {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return strip(a) === strip(b);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
