/**
 * Paddle API plumbing (M5, ADR-0004). Paddle is the Merchant of Record: it
 * sells to the customer and handles tax/invoices; we talk to its Billing API
 * for catalog + subscription state. Thin fetch client on purpose, no SDK.
 */

export interface PaddleConfig {
  baseUrl: string;
  apiKey: string;
}

const BASE_URLS = {
  sandbox: "https://sandbox-api.paddle.com",
  live: "https://api.paddle.com",
} as const;

/** null when Paddle isn't configured (e.g. tests, local dev without billing). */
export function paddleConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PaddleConfig | null {
  const apiKey = env.PADDLE_API_KEY;
  if (!apiKey) return null;
  const mode = env.PADDLE_ENV === "live" ? "live" : "sandbox";
  return { baseUrl: BASE_URLS[mode], apiKey };
}

export class PaddleApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
  ) {
    super(`paddle: ${code}: ${detail}`);
    this.name = "PaddleApiError";
  }
}

/** Minimal JSON client for the Paddle Billing API. */
export class PaddleApi {
  constructor(
    private readonly config: PaddleConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json()) as { data?: T; error?: { code?: string; detail?: string } };
    if (!res.ok) {
      throw new PaddleApiError(
        res.status,
        json.error?.code ?? "unknown",
        json.error?.detail ?? "request failed",
      );
    }
    return json.data as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }
  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }
}
