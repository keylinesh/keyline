import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Settings } from "./Settings.js";
import { resetPaddleForTests, type PaddleJs } from "../billing.js";
import type { WebSession } from "../session.js";

const admin: WebSession = {
  token: "klk_a",
  expiresAt: "2099-01-01T00:00:00Z",
  workspaceId: "w1",
  memberId: "m1",
  role: "owner",
};

const CONFIG = { environment: "sandbox", clientToken: "test_tok", teamPriceId: "pri_team" };

function stubFetch(opts: { plan?: string; config?: boolean; subscription?: unknown; portal?: unknown } = {}) {
  const plan = { value: opts.plan ?? "solo" };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.includes("/billing/subscription"))
      return new Response(JSON.stringify({ subscription: opts.subscription ?? null }), { status: 200 });
    if (url.includes("/billing/portal"))
      return new Response(JSON.stringify(opts.portal ?? {}), { status: 200 });
    if (url.includes("/billing/config")) {
      return opts.config === false
        ? new Response(JSON.stringify({ error: { code: "not_found", message: "billing not configured" } }), { status: 404 })
        : new Response(JSON.stringify(CONFIG), { status: 200 });
    }
    if (url.includes("/members"))
      return new Response(JSON.stringify({ members: [{ id: "m1", email: "founder@acme.test", displayName: null, role: "owner", createdAt: "" }] }), { status: 200 });
    if (method === "GET" && url.includes("/workspaces/w1"))
      return new Response(JSON.stringify({ id: "w1", name: "Acme", plan: plan.value }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  });
  return { setPlan: (p: string) => (plan.value = p) };
}

/** A fake window.Paddle so ensurePaddle never injects the CDN script. */
function stubPaddle() {
  const calls = { env: [] as string[], init: [] as any[], open: [] as any[] };
  let eventCallback: ((e: { name: string }) => void) | undefined;
  const paddle: PaddleJs = {
    Environment: { set: (e) => calls.env.push(e) },
    Initialize: (o) => {
      calls.init.push(o);
      eventCallback = o.eventCallback;
    },
    Checkout: { open: (o) => calls.open.push(o) },
  };
  vi.stubGlobal("Paddle", paddle);
  (window as any).Paddle = paddle;
  return { calls, fire: (name: string) => eventCallback?.({ name }) };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as any).Paddle;
  resetPaddleForTests();
});

describe("Billing (Settings) — #71", () => {
  test("solo admin sees the upgrade button; clicking opens a Paddle checkout for this workspace", async () => {
    stubFetch();
    const paddle = stubPaddle();
    render(<Settings session={admin} />);

    const btn = await screen.findByText("Upgrade to Team");
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);

    await waitFor(() => expect(paddle.calls.open.length).toBe(1), { timeout: 4000 });
    expect(paddle.calls.env).toEqual(["sandbox"]);
    expect(paddle.calls.init[0].token).toBe("test_tok");
    const open = paddle.calls.open[0];
    expect(open.items).toEqual([{ priceId: "pri_team", quantity: 1 }]);
    expect(open.customData).toEqual({ workspaceId: "w1" });
    expect(open.customer).toEqual({ email: "founder@acme.test" });
  });

  test("checkout.completed polls the workspace and lands on the Team plan", async () => {
    const fetchCtl = stubFetch();
    const paddle = stubPaddle();
    render(<Settings session={admin} />);

    // Wait for the config fetch to enable the button; clicking while it is
    // still disabled is a silent no-op and was the source of a CI-only flake.
    const btn = await screen.findByText("Upgrade to Team");
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(paddle.calls.open.length).toBe(1), { timeout: 4000 });

    fetchCtl.setPlan("team"); // the webhook has flipped it server-side
    paddle.fire("checkout.completed");

    expect(await screen.findByText("Team · $19/mo")).toBeDefined();
    expect(screen.queryByText("Upgrade to Team")).toBeNull();
  });

  test("team workspaces show the plan, no upgrade button", async () => {
    stubFetch({ plan: "team" });
    render(<Settings session={admin} />);
    expect(await screen.findByText("Team · $19/mo")).toBeDefined();
    expect(screen.queryByText("Upgrade to Team")).toBeNull();
  });

  test("Manage billing opens the Paddle portal (#72)", async () => {
    stubFetch({
      plan: "team",
      subscription: { status: "active", currentPeriodEnd: null, pastDueSince: null },
      portal: { overviewUrl: "https://p.example/overview", cancelUrl: null, updatePaymentMethodUrl: null },
    });
    const open = vi.fn();
    vi.stubGlobal("open", open);
    render(<Settings session={admin} />);

    fireEvent.click(await screen.findByText("Manage billing"));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://p.example/overview", "_blank", "noopener"));
  });

  test("past_due shows the payment-issue warning; trialing shows the trial end (#74)", async () => {
    stubFetch({
      plan: "team",
      subscription: { status: "past_due", currentPeriodEnd: null, pastDueSince: "2026-07-14T16:00:00Z" },
    });
    const { unmount } = render(<Settings session={admin} />);
    expect(await screen.findByText(/Payment issue/)).toBeDefined();
    unmount();

    stubFetch({
      plan: "team",
      subscription: { status: "trialing", currentPeriodEnd: "2026-07-28T00:00:00Z", pastDueSince: null },
    });
    render(<Settings session={admin} />);
    expect(await screen.findByText(/Free trial until 2026-07-28/)).toBeDefined();
  });

  test("non-admins are told to ask an admin", async () => {
    stubFetch();
    render(<Settings session={{ ...admin, role: "member" }} />);
    expect(await screen.findByText("Ask an owner or admin to upgrade.")).toBeDefined();
    expect(screen.queryByText("Upgrade to Team")).toBeNull();
  });

  test("without server billing config the button is replaced by an honest hint", async () => {
    stubFetch({ config: false });
    render(<Settings session={admin} />);
    expect(await screen.findByText("Billing isn't configured in this environment.")).toBeDefined();
    expect(screen.queryByText("Upgrade to Team")).toBeNull();
  });
});
