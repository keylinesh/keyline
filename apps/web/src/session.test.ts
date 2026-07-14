import { describe, expect, it, test } from "vitest";
import { ApiError, request } from "./api.js";
import {
  claimSession,
  clearSession,
  loadSession,
  saveSession,
  startSignIn,
  waitForApproval,
  type WebSession,
} from "./session.js";

/** fetch stub returning queued JSON responses. */
function fetchQueue(responses: Array<{ status?: number; body: unknown }>): typeof fetch {
  let i = 0;
  return (async () => {
    const next = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

/** Minimal in-memory Storage. */
function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("api request", () => {
  test("unwraps the error envelope", async () => {
    const fetchImpl = fetchQueue([
      { status: 404, body: { error: { code: "not_found", message: "nope" } } },
    ]);
    await expect(request("GET", "/v1/x", { fetchImpl })).rejects.toMatchObject({
      status: 404,
      code: "not_found",
      message: "nope",
    });
  });

  test("network failure becomes a friendly ApiError", async () => {
    const fetchImpl = (() => Promise.reject(new Error("boom"))) as unknown as typeof fetch;
    await expect(request("GET", "/v1/x", { fetchImpl })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("sign-in flow", () => {
  test("start returns the session and code", async () => {
    const fetchImpl = fetchQueue([
      { status: 201, body: { sessionId: "s1", code: "AAAA-BBBB", expiresAt: "2099-01-01T00:00:00Z" } },
    ]);
    const started = await startSignIn(fetchImpl);
    expect(started.code).toBe("AAAA-BBBB");
  });

  test("waitForApproval polls until ready", async () => {
    const fetchImpl = fetchQueue([
      { body: { status: "pending" } },
      { body: { status: "pending" } },
      { body: { status: "ready", token: "klk_x", expiresAt: "2099-01-01T00:00:00Z", workspaceId: "w1" } },
    ]);
    const session = await waitForApproval("s1", { fetchImpl, sleep: async () => {} });
    expect(session).toMatchObject({ token: "klk_x", workspaceId: "w1" });
  });

  test("waitForApproval gives up on expiry", async () => {
    const fetchImpl = fetchQueue([{ body: { status: "expired" } }]);
    expect(await waitForApproval("s1", { fetchImpl, sleep: async () => {} })).toBeNull();
  });

  test("claim passes the session id through", async () => {
    const fetchImpl = fetchQueue([{ body: { status: "consumed" } }]);
    expect((await claimSession("s1", fetchImpl)).status).toBe("consumed");
  });
});

describe("session storage", () => {
  const live: WebSession = { token: "klk_x", expiresAt: "2099-01-01T00:00:00Z", workspaceId: "w1" };

  test("round-trips a live session", () => {
    const storage = memStorage();
    saveSession(live, storage);
    expect(loadSession(storage)).toEqual(live);
    clearSession(storage);
    expect(loadSession(storage)).toBeNull();
  });

  test("drops an expired session", () => {
    const storage = memStorage();
    saveSession({ ...live, expiresAt: "2000-01-01T00:00:00Z" }, storage);
    expect(loadSession(storage)).toBeNull();
    expect(storage.getItem("keyline.web.session")).toBeNull();
  });

  test("drops corrupt storage", () => {
    const storage = memStorage();
    storage.setItem("keyline.web.session", "{not json");
    expect(loadSession(storage)).toBeNull();
  });
});

describe("magic links (#68)", () => {
  it("extracts the #ml= token from the hash and ignores everything else", async () => {
    const { magicTokenFromLocation } = await import("./session.js");
    expect(magicTokenFromLocation("#ml=abcdefghijklmnop123")).toBe("abcdefghijklmnop123");
    expect(magicTokenFromLocation("#settings")).toBeNull();
    expect(magicTokenFromLocation("#ml=short")).toBeNull();
    expect(magicTokenFromLocation("")).toBeNull();
  });
});
