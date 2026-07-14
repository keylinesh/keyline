import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureTeamCatalog, TEAM_PLAN } from "./catalog.js";
import { PaddleApi, PaddleApiError, paddleConfigFromEnv } from "./paddle.js";

/** A fake Paddle backend: in-memory products/prices behind a fetch stub. */
function fakePaddle() {
  const products: any[] = [];
  const prices: any[] = [];
  let seq = 0;
  const calls: string[] = [];

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = new URL(url).pathname;
    calls.push(`${method} ${path}`);
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    let data: unknown;
    if (method === "GET" && path === "/products") data = products;
    else if (method === "POST" && path === "/products") {
      data = { id: `pro_${++seq}`, status: "active", ...body };
      products.push(data);
    } else if (method === "GET" && path === "/prices") {
      const pid = new URL(url).searchParams.get("product_id");
      data = prices.filter((p) => p.product_id === pid);
    } else if (method === "POST" && path === "/prices") {
      data = { id: `pri_${++seq}`, status: "active", ...body };
      prices.push(data);
    } else {
      return new Response(JSON.stringify({ error: { code: "not_found", detail: path } }), {
        status: 404,
      });
    }
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as unknown as typeof fetch;

  const api = new PaddleApi({ baseUrl: "https://sandbox-api.paddle.com", apiKey: "k" }, fetchImpl);
  return { api, products, prices, calls };
}

test("first run creates the Team product and price with plan mapping", async () => {
  const { api, products, prices } = fakePaddle();
  const result = await ensureTeamCatalog(api);

  assert.equal(result.created.product, true);
  assert.equal(result.created.price, true);
  assert.equal(products.length, 1);
  assert.equal(products[0].name, TEAM_PLAN.productName);
  assert.equal(products[0].tax_category, "saas");
  assert.deepEqual(products[0].custom_data, { plan: "team" });
  assert.equal(prices.length, 1);
  assert.equal(prices[0].unit_price.amount, "1900");
  assert.equal(prices[0].trial_period.frequency, 14);
  assert.deepEqual(prices[0].custom_data, { plan: "team" });
});

test("re-running finds the existing catalog and creates nothing", async () => {
  const { api, products, prices } = fakePaddle();
  const first = await ensureTeamCatalog(api);
  const second = await ensureTeamCatalog(api);

  assert.deepEqual(second.created, { product: false, price: false });
  assert.equal(second.productId, first.productId);
  assert.equal(second.priceId, first.priceId);
  assert.equal(products.length, 1);
  assert.equal(prices.length, 1);
});

test("archived or unrelated products are not reused", async () => {
  const { api, products } = fakePaddle();
  products.push({ id: "pro_old", status: "archived", custom_data: { plan: "team" } });
  products.push({ id: "pro_other", status: "active", custom_data: { plan: "enterprise" } });

  const result = await ensureTeamCatalog(api);
  assert.equal(result.created.product, true);
  assert.notEqual(result.productId, "pro_old");
  assert.notEqual(result.productId, "pro_other");
});

test("API errors surface with Paddle's code and status", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ error: { code: "forbidden", detail: "bad key" } }), {
      status: 403,
    })) as unknown as typeof fetch;
  const api = new PaddleApi({ baseUrl: "https://sandbox-api.paddle.com", apiKey: "k" }, fetchImpl);

  await assert.rejects(ensureTeamCatalog(api), (err: PaddleApiError) => {
    assert.equal(err.status, 403);
    assert.equal(err.code, "forbidden");
    return true;
  });
});

test("paddleConfigFromEnv: sandbox by default, live only when asked, null without key", () => {
  assert.equal(paddleConfigFromEnv({}), null);
  assert.equal(
    paddleConfigFromEnv({ PADDLE_API_KEY: "k" })?.baseUrl,
    "https://sandbox-api.paddle.com",
  );
  assert.equal(
    paddleConfigFromEnv({ PADDLE_API_KEY: "k", PADDLE_ENV: "live" })?.baseUrl,
    "https://api.paddle.com",
  );
});
