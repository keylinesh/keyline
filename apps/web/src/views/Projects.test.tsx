import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Projects } from "./Projects.js";
import type { WebSession } from "../session.js";

const admin: WebSession = {
  token: "klk_a",
  expiresAt: "2099-01-01T00:00:00Z",
  workspaceId: "w1",
  memberId: "m1",
  role: "owner",
};
const member: WebSession = { ...admin, role: "member" };

type Route = { match: (method: string, url: string) => boolean; status?: number; body: unknown };

/** Stub global fetch with route matchers; records calls. */
function stubFetch(routes: Route[]) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const route = routes.find((r) => r.match(method, url));
      if (!route) return new Response(JSON.stringify({ error: { code: "not_found", message: "no stub" } }), { status: 404 });
      return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
    },
  );
  return calls;
}

const baseRoutes: Route[] = [
  {
    match: (m, u) => m === "GET" && u.includes("/workspaces/w1/projects"),
    body: { projects: [{ id: "p1", name: "Acme API", slug: "acme-api" }] },
  },
  {
    match: (m, u) => m === "GET" && u.includes("/projects/p1/environments"),
    body: { environments: [{ id: "e1", name: "prod" }, { id: "e2", name: "dev" }] },
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Projects view", () => {
  test("lists projects with environment chips", async () => {
    stubFetch(baseRoutes);
    render(<Projects session={admin} />);
    expect(await screen.findByText("Acme API")).toBeDefined();
    expect(screen.getByText("acme-api")).toBeDefined();
    expect(screen.getByText("prod")).toBeDefined();
    expect(screen.getByText("dev")).toBeDefined();
  });

  test("admin sees create/rename/delete controls; member does not", async () => {
    stubFetch(baseRoutes);
    const { unmount } = render(<Projects session={admin} />);
    await screen.findByText("Acme API");
    expect(screen.getByLabelText("new project name")).toBeDefined();
    expect(screen.getByText("rename")).toBeDefined();
    unmount();

    stubFetch(baseRoutes);
    render(<Projects session={member} />);
    await screen.findByText("Acme API");
    expect(screen.queryByLabelText("new project name")).toBeNull();
    expect(screen.queryByText("rename")).toBeNull();
  });

  test("creating a project POSTs name + slug", async () => {
    const calls = stubFetch([
      ...baseRoutes,
      {
        match: (m, u) => m === "POST" && u.includes("/workspaces/w1/projects"),
        status: 201,
        body: { id: "p2", name: "My New App", slug: "my-new-app" },
      },
    ]);
    render(<Projects session={admin} />);
    const input = await screen.findByLabelText("new project name");
    fireEvent.change(input, { target: { value: "My New App" } });
    fireEvent.submit(screen.getByText("New project").closest("form")!);

    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST");
      expect(post?.body).toEqual({ name: "My New App", slug: "my-new-app" });
    });
  });

  test("a 403 from the API surfaces as a readable banner", async () => {
    stubFetch([
      {
        match: (m, u) => m === "GET" && u.includes("/projects"),
        status: 403,
        body: { error: { code: "forbidden", message: "requires admin" } },
      },
    ]);
    render(<Projects session={member} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/admin access/);
  });

  test("empty workspace explains next steps", async () => {
    stubFetch([
      { match: (m, u) => m === "GET" && u.includes("/workspaces/w1/projects"), body: { projects: [] } },
    ]);
    render(<Projects session={admin} />);
    expect((await screen.findByText(/No projects yet/)).textContent).toMatch(/keyline link/);
  });
});
