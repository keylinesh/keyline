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

/**
 * What the dashboard needs to open a checkout (#71). All public by nature:
 * the client token ships to browsers and the price id appears in checkouts.
 */
export interface BillingPublicConfig {
  environment: "sandbox" | "live";
  clientToken: string;
  teamPriceId: string;
}

export function billingPublicConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BillingPublicConfig | null {
  const clientToken = env.PADDLE_CLIENT_TOKEN;
  const teamPriceId = env.PADDLE_TEAM_PRICE_ID;
  if (!clientToken || !teamPriceId) return null;
  return { environment: env.PADDLE_ENV === "live" ? "live" : "sandbox", clientToken, teamPriceId };
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

  /** Follow Paddle's cursor pagination until exhausted. */
  async getAll<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    let url: string | null = `${this.config.baseUrl}${path}`;
    while (url) {
      const res = await this.fetchImpl(url, {
        headers: { authorization: `Bearer ${this.config.apiKey}` },
      });
      const json = (await res.json()) as {
        data?: T[];
        error?: { code?: string; detail?: string };
        meta?: { pagination?: { has_more?: boolean; next?: string } };
      };
      if (!res.ok) {
        throw new PaddleApiError(
          res.status,
          json.error?.code ?? "unknown",
          json.error?.detail ?? "request failed",
        );
      }
      items.push(...(json.data ?? []));
      url = json.meta?.pagination?.has_more ? (json.meta.pagination.next ?? null) : null;
    }
    return items;
  }
}
