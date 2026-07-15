import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Members } from "./Members.js";
import type { WebSession } from "../session.js";

const admin: WebSession = {
  token: "klk_a",
  expiresAt: "2099-01-01T00:00:00Z",
  workspaceId: "w1",
  memberId: "m-owner",
  role: "owner",
};
const member: WebSession = { ...admin, role: "member", memberId: "m-dev" };

type Route = { match: (method: string, url: string) => boolean; status?: number; body: unknown };

function stubFetch(routes: Route[]) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes.find((r) => r.match(method, url));
    if (!route) return new Response(JSON.stringify({ error: { code: "not_found", message: `no stub: ${method} ${url}` } }), { status: 404 });
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  });
  return calls;
}

const MEMBERS = {
  members: [
    { id: "m-owner", email: "founder@acme.test", displayName: null, role: "owner", createdAt: "2026-01-01T00:00:00Z" },
    { id: "m-dev", email: "dev@acme.test", displayName: null, role: "member", createdAt: "2026-01-02T00:00:00Z" },
    { id: "m-new", email: "new@acme.test", displayName: null, role: "member", createdAt: "2026-01-03T00:00:00Z" },
  ],
};

const ENV = { id: "e1", name: "prod", projectId: "p1", projectSlug: "acme-api", label: "acme-api/prod" };

// The page loads from the single overview endpoint (#41 perf).
const OVERVIEW = {
  environments: [ENV],
  members: [
    { ...MEMBERS.members[0]!, status: "active", keyed: true, grants: [] },
    { ...MEMBERS.members[1]!, status: "active", keyed: false, grants: [{ environmentId: "e1", role: "write" }] },
    { ...MEMBERS.members[2]!, status: "invited", keyed: false, grants: [] },
  ],
};

const baseRoutes: Route[] = [
  { match: (m, u) => m === "GET" && u.includes("/workspaces/w1/members/overview"), body: OVERVIEW },
  { match: (m, u) => m === "GET" && u.includes("/workspaces/w1/members"), body: MEMBERS },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Members view", () => {
  test("admin sees statuses, key hints, and grants", async () => {
    stubFetch(baseRoutes);
    render(<Members session={admin} />);
    expect(await screen.findByText("founder@acme.test")).toBeDefined();
    expect(screen.getAllByText("active").length).toBe(2);
    expect(screen.getByText("invited")).toBeDefined();
    expect(screen.getByText("no key yet")).toBeDefined(); // dev is active but keyless
    expect(screen.getByText(/acme-api\/prod: write/)).toBeDefined(); // dev's grant chip
    expect(screen.getByText("you")).toBeDefined();
  });

  test("plain member sees the list without admin controls", async () => {
    stubFetch([baseRoutes[1]!]); // plain members use the simple list, not the admin overview
    render(<Members session={member} />);
    expect(await screen.findByText("founder@acme.test")).toBeDefined();
    expect(screen.queryByLabelText("invite email")).toBeNull();
    expect(screen.queryByText("revoke")).toBeNull();
    expect(screen.queryByText("invited")).toBeNull(); // no device probing without admin
  });

  test("invite POSTs email + role", async () => {
    const calls = stubFetch([
      ...baseRoutes,
      { match: (m, u) => m === "POST" && u.includes("/workspaces/w1/members"), status: 201, body: MEMBERS.members[2] },
    ]);
    render(<Members session={admin} />);
    fireEvent.change(await screen.findByLabelText("invite email"), { target: { value: "pm@acme.test" } });
    fireEvent.change(screen.getByLabelText("invite role"), { target: { value: "admin" } });
    fireEvent.submit(screen.getByText("Invite").closest("form")!);
    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && c.url.includes("/members"));
      expect(post?.body).toEqual({ email: "pm@acme.test", role: "admin" });
    });
  });

  test("one-click revoke calls the endpoint and reports counts", async () => {
    vi.stubGlobal("confirm", () => true);
    const calls = stubFetch([
      ...baseRoutes,
      {
        match: (m, u) => m === "POST" && u.includes("/members/m-dev/revoke"),
        body: { tokensRevoked: 2, devicesRevoked: 1, wrappedKeysDeleted: 1 },
      },
    ]);
    render(<Members session={admin} />);
    await screen.findByText("dev@acme.test");
    fireEvent.click(screen.getAllByText("revoke")[0]!);
    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.url.includes("/members/m-dev/revoke"))).toBe(true);
    });
    expect((await screen.findByRole("status")).textContent).toMatch(/2 sessions ended/);
  });

  test("granting scope PUTs env access", async () => {
    const calls = stubFetch([
      ...baseRoutes,
      { match: (m, u) => m === "PUT" && u.includes("/environments/e1/access"), body: { memberId: "m-new", role: "read" } },
    ]);
    render(<Members session={admin} />);
    await screen.findByText("new@acme.test");
    fireEvent.change(screen.getByLabelText("grant environment for new@acme.test"), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText("grant role for new@acme.test"), { target: { value: "read" } });
    fireEvent.submit(screen.getByLabelText("grant environment for new@acme.test").closest("form")!);
    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT");
      expect(put?.body).toEqual({ memberId: "m-new", role: "read" });
    });
  });

  test("self row has no revoke button", async () => {
    stubFetch(baseRoutes);
    render(<Members session={admin} />);
    await screen.findByText("founder@acme.test");
    // founder is session.memberId; only dev + new rows can have revoke, new is 'invited' (still revocable)
    const revokes = screen.getAllByText("revoke");
    expect(revokes.length).toBe(2);
  });
});

describe("join codes (#66)", () => {
  test("inviting shows the one-time join command with a copy button", async () => {
    stubFetch([
      {
        match: (m, u) => m === "POST" && u.includes("/workspaces/w1/members"),
        status: 201,
        body: { id: "m-x", email: "mate@acme.test", displayName: null, role: "member", createdAt: "", joinCode: "ABCD-EFGH-JKMN", joinCodeExpiresAt: "2026-07-21T00:00:00Z" },
      },
      ...baseRoutes,
    ]);
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => {}) } });
    render(<Members session={admin} />);
    fireEvent.change(await screen.findByLabelText("invite email"), { target: { value: "mate@acme.test" } });
    fireEvent.submit(screen.getByLabelText("invite email").closest("form")!);

    expect(await screen.findByText("keyline join ABCD-EFGH-JKMN")).toBeDefined();
    expect(screen.getByLabelText("copy join command for mate@acme.test")).toBeDefined();
  });

  test("invited members get a resend button that surfaces a fresh code", async () => {
    stubFetch([
      {
        match: (m, u) => m === "POST" && u.includes("/members/m-new/join-code"),
        body: { joinCode: "WXYZ-WXYZ-WXYZ", joinCodeExpiresAt: "2026-07-21T00:00:00Z" },
      },
      ...baseRoutes,
    ]);
    render(<Members session={admin} />);
    fireEvent.click(await screen.findByText("resend invite"));
    expect(await screen.findByText("keyline join WXYZ-WXYZ-WXYZ")).toBeDefined();
  });
});

test("when nothing was ever pushed, the hint says so instead of 'no key yet'", async () => {
  stubFetch([
    {
      match: (m, u) => m === "GET" && u.includes("/workspaces/w1/members/overview"),
      body: { ...OVERVIEW, members: OVERVIEW.members.map((m) => ({ ...m, keyed: false })) },
    },
  ]);
  render(<Members session={admin} />);
  expect((await screen.findAllByText("nothing pushed yet")).length).toBeGreaterThan(0);
  expect(screen.queryByText("no key yet")).toBeNull();
});
