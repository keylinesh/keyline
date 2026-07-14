import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Settings } from "./Settings.js";
import type { WebSession } from "../session.js";

const admin: WebSession = {
  token: "klk_a",
  expiresAt: "2099-01-01T00:00:00Z",
  workspaceId: "w1",
  memberId: "m1",
  role: "owner",
};

function stubFetch() {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "PATCH" && url.includes("/members/m1"))
      return new Response(JSON.stringify({ id: "m1", email: "founder@acme.test", displayName: "Resi", role: "owner", createdAt: "" }), { status: 200 });
    if (method === "PATCH" && url.includes("/workspaces/w1"))
      return new Response(JSON.stringify({ id: "w1", name: "Acme Corp", plan: "solo" }), { status: 200 });
    if (url.includes("/billing/config"))
      return new Response(JSON.stringify({ error: { code: "not_found", message: "billing not configured" } }), { status: 404 });
    if (url.includes("/members"))
      return new Response(JSON.stringify({ members: [{ id: "m1", email: "founder@acme.test", displayName: null, role: "owner", createdAt: "" }] }), { status: 200 });
    return new Response(JSON.stringify({ id: "w1", name: "Acme Inc", plan: "solo" }), { status: 200 });
  });
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Settings view", () => {
  test("shows account, workspace, and the billing entry point", async () => {
    stubFetch();
    render(<Settings session={admin} />);
    expect(await screen.findByText("founder@acme.test")).toBeDefined();
    expect(screen.getByText("Billing")).toBeDefined();
    expect(await screen.findByText("Solo · $0")).toBeDefined();
    expect(screen.getByText(/14-day free trial/)).toBeDefined();
  });

  test("saving the display name PATCHes the member", async () => {
    const calls = stubFetch();
    render(<Settings session={admin} />);
    fireEvent.change(await screen.findByLabelText("display name"), { target: { value: "Resi" } });
    fireEvent.submit(screen.getByLabelText("display name").closest("form")!);
    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH" && c.url.includes("/members/m1"));
      expect(patch?.body).toEqual({ displayName: "Resi" });
    });
  });

  test("admin can rename the workspace; member cannot", async () => {
    const calls = stubFetch();
    const { unmount } = render(<Settings session={admin} />);
    fireEvent.change(await screen.findByLabelText("workspace name"), { target: { value: "Acme Corp" } });
    fireEvent.submit(screen.getByLabelText("workspace name").closest("form")!);
    await waitFor(() => {
      expect(calls.some((c) => c.method === "PATCH" && c.url.includes("/workspaces/w1"))).toBe(true);
    });
    unmount();

    stubFetch();
    render(<Settings session={{ ...admin, role: "member" }} />);
    await screen.findByText("founder@acme.test");
    expect(screen.queryByLabelText("workspace name")).toBeNull();
  });
});
