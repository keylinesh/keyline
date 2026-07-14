import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiClient, ApiError } from "./api-client.js";

type Captured = { url: string; init: RequestInit };

function fakeFetch(response: Response, captured?: Captured[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    captured?.push({ url: String(url), init: init ?? {} });
    return response;
  }) as unknown as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("builds URL, auth header, and JSON body", async () => {
  const captured: Captured[] = [];
  const client = new ApiClient({
    baseUrl: "https://api.example.com/",
    token: "klk_secret",
    fetchImpl: fakeFetch(json({ ok: true }, 201), captured),
  });
  const out = await client.post<{ ok: boolean }>("/v1/workspaces", { name: "Acme" });
  assert.deepEqual(out, { ok: true });
  assert.equal(captured[0]!.url, "https://api.example.com/v1/workspaces"); // trailing slash trimmed
  const headers = captured[0]!.init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer klk_secret");
  assert.equal(headers["content-type"], "application/json");
  assert.equal(captured[0]!.init.body, JSON.stringify({ name: "Acme" }));
});

test("omits auth header when no token", async () => {
  const captured: Captured[] = [];
  const client = new ApiClient({ baseUrl: "https://x", fetchImpl: fakeFetch(json({}), captured) });
  await client.get("/health");
  assert.equal((captured[0]!.init.headers as Record<string, string>).authorization, undefined);
});

test("maps the error envelope to a typed ApiError", async () => {
  const client = new ApiClient({
    baseUrl: "https://x",
    fetchImpl: fakeFetch(json({ error: { code: "forbidden", message: "nope" } }, 403)),
  });
  await assert.rejects(
    () => client.get("/v1/workspaces/abc"),
    (err: ApiError) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 403);
      assert.equal(err.code, "forbidden");
      assert.equal(err.message, "nope");
      return true;
    },
  );
});

test("wraps network failures as a network_error ApiError", async () => {
  const failing = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  const client = new ApiClient({ baseUrl: "https://down", fetchImpl: failing });
  await assert.rejects(
    () => client.get("/health"),
    (err: ApiError) => {
      assert.equal(err.code, "network_error");
      assert.equal(err.status, 0);
      return true;
    },
  );
});

test("follows an apex→www 308 and keeps the auth header (the redirect that broke prod)", async () => {
  const captured: Captured[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    if (String(url).startsWith("https://keyline.sh/")) {
      return new Response(null, {
        status: 308,
        headers: { location: String(url).replace("https://keyline.sh/", "https://www.keyline.sh/") },
      });
    }
    return json({ ok: true });
  }) as unknown as typeof fetch;

  const client = new ApiClient({ baseUrl: "https://keyline.sh/api", token: "klk_t", fetchImpl });
  const out = await client.get<{ ok: boolean }>("/v1/workspaces/w1");
  assert.deepEqual(out, { ok: true });
  assert.equal(captured.length, 2);
  assert.equal(captured[1]!.url, "https://www.keyline.sh/api/v1/workspaces/w1");
  assert.equal((captured[1]!.init.headers as Record<string, string>).authorization, "Bearer klk_t");
});

test("a redirect to a foreign host fails loudly instead of leaking or dropping auth", async () => {
  const fetchImpl = (async () =>
    new Response(null, { status: 308, headers: { location: "https://evil.example.com/api" } })) as unknown as typeof fetch;
  const client = new ApiClient({ baseUrl: "https://keyline.sh/api", token: "klk_t", fetchImpl });
  await assert.rejects(
    () => client.get("/health"),
    (err: ApiError) => {
      assert.equal(err.code, "redirect_error");
      assert.match(err.message, /evil\.example\.com/);
      assert.match(err.message, /KEYLINE_API_URL/);
      return true;
    },
  );
});

test("redirect loops give up after a few hops", async () => {
  const fetchImpl = (async (url: string | URL) =>
    new Response(null, { status: 308, headers: { location: String(url) } })) as unknown as typeof fetch;
  const client = new ApiClient({ baseUrl: "https://keyline.sh/api", fetchImpl });
  await assert.rejects(
    () => client.get("/health"),
    (err: ApiError) => {
      assert.equal(err.code, "redirect_error");
      assert.match(err.message, /too many redirects/);
      return true;
    },
  );
});
