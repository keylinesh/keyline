import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiClient } from "../api-client.js";
import { harness } from "../test-harness.js";
import { runWebApprove } from "./web.js";

test("keyline web approves a browser session that then yields a working token", async () => {
  const h = await harness();
  try {
    const anon = new ApiClient({ baseUrl: "", fetchImpl: h.fetchImpl });
    const start = await anon.post<{ sessionId: string; code: string }>("/v1/web/sessions");

    const result = await runWebApprove(h.deps, ` ${start.code.toLowerCase()} `);
    assert.ok(result.workspaceId);

    const claim = await anon.post<{ status: string; token?: string }>(
      `/v1/web/sessions/${start.sessionId}/claim`,
    );
    assert.equal(claim.status, "ready");

    const web = new ApiClient({ baseUrl: "", token: claim.token, fetchImpl: h.fetchImpl });
    const { members } = await web.get<{ members: unknown[] }>(
      `/v1/workspaces/${result.workspaceId}/members`,
    );
    assert.equal(members.length, 1);
  } finally {
    h.cleanup();
  }
});

test("keyline web with a bad code explains itself", async () => {
  const h = await harness();
  try {
    await assert.rejects(() => runWebApprove(h.deps, "ZZZZ-ZZZZ"), /expired, mistyped, or already used/);
    await assert.rejects(() => runWebApprove(h.deps, "  "), /No code given/);
  } finally {
    h.cleanup();
  }
});

test("keyline web before login is rejected", async () => {
  const h = await harness();
  try {
    h.deps.store.delete("access-token");
    await assert.rejects(() => runWebApprove(h.deps, "AAAA-BBBB"), /login/);
  } finally {
    h.cleanup();
  }
});
