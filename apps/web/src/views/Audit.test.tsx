import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Audit } from "./Audit.js";
import { distinctActions, filterEvents, toCSV, type AuditEvent } from "../audit.js";
import type { WebSession } from "../session.js";

const admin: WebSession = {
  token: "klk_a",
  expiresAt: "2099-01-01T00:00:00Z",
  workspaceId: "w1",
  memberId: "m1",
  role: "owner",
};

const EVENTS: AuditEvent[] = [
  {
    seq: 1, action: "bundle.push", outcome: "allowed", actorMemberId: "m1", actorDeviceId: "d1",
    targetType: "environment", targetId: "e1", metadata: { version: 1 },
    createdAt: "2026-07-11T10:00:00.000Z", hash: "h1", prevHash: "h0",
  },
  {
    seq: 2, action: "bundle.pull", outcome: "denied", actorMemberId: "m2", actorDeviceId: "d2",
    targetType: "environment", targetId: "e2", metadata: { reason: "requires read" },
    createdAt: "2026-07-11T10:01:00.000Z", hash: "h2", prevHash: "h1",
  },
];

function stubFetch() {
  vi.stubGlobal("fetch", async (url: string) => {
    const body = url.includes("/audit/verify")
      ? { ok: true, count: 2 }
      : url.includes("/audit")
        ? { events: EVENTS }
        : {
            // the single members/overview response (#41 perf)
            environments: [
              { id: "e1", name: "prod", projectId: "p1", projectSlug: "api", label: "api/prod" },
              { id: "e2", name: "dev", projectId: "p1", projectSlug: "api", label: "api/dev" },
            ],
            members: [
              { id: "m1", email: "founder@acme.test", displayName: null, role: "owner", createdAt: "", status: "active", keyed: true, grants: [] },
              { id: "m2", email: "dev@acme.test", displayName: null, role: "member", createdAt: "", status: "active", keyed: true, grants: [] },
            ],
          };
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("audit helpers", () => {
  test("filterEvents by env, member, action", () => {
    expect(filterEvents(EVENTS, { environmentId: "e1" }).map((e) => e.seq)).toEqual([1]);
    expect(filterEvents(EVENTS, { actorMemberId: "m2" }).map((e) => e.seq)).toEqual([2]);
    expect(filterEvents(EVENTS, { action: "bundle.push" }).map((e) => e.seq)).toEqual([1]);
    expect(filterEvents(EVENTS, {}).length).toBe(2);
  });

  test("distinctActions is sorted and unique", () => {
    expect(distinctActions(EVENTS)).toEqual(["bundle.pull", "bundle.push"]);
  });

  test("toCSV resolves actors and escapes metadata", () => {
    const csv = toCSV(EVENTS, new Map([["m1", "founder@acme.test"]]));
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("seq,time,actor,action,outcome,target,metadata");
    expect(lines[1]).toContain("founder@acme.test");
    expect(lines[1]).toContain('"{""version"":1}"');
    expect(lines[2]).toContain("m2"); // unknown member falls back to id
  });
});

describe("Audit view", () => {
  test("renders verify badge, events with emails and env labels", async () => {
    stubFetch();
    render(<Audit session={admin} />);
    expect((await screen.findByRole("status")).textContent).toMatch(/chain intact · 2 events/);
    // emails/actions also appear in filter dropdowns: assert the table cells exist
    expect(screen.getAllByText("founder@acme.test").length).toBeGreaterThanOrEqual(2); // option + cell
    expect(screen.getAllByText("bundle.push").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("denied")).toBeDefined(); // outcome pill (table only)
    expect(screen.getAllByText("api/prod").length).toBeGreaterThanOrEqual(2); // option + cell
  });

  test("filtering by action narrows the table", async () => {
    stubFetch();
    render(<Audit session={admin} />);
    await screen.findByText("denied");
    expect(screen.getAllByText("bundle.push").length).toBe(2); // option + table cell
    fireEvent.change(screen.getByLabelText("filter action"), { target: { value: "bundle.pull" } });
    expect(screen.getAllByText("bundle.push").length).toBe(1); // option only — row gone
    expect(screen.getAllByText("bundle.pull").length).toBe(2); // option + remaining row
  });

  test("plain member sees the admin-only explanation without fetching", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return new Response("{}", { status: 200 });
    });
    render(<Audit session={{ ...admin, role: "member" }} />);
    expect((await screen.findByText(/admin-only/)).textContent).toBeDefined();
    expect(calls.length).toBe(0);
  });
});
