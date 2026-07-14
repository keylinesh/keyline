import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiClient } from "../api-client.js";
import { loadAccount } from "../account.js";
import { loadCredentials } from "../credentials.js";
import { harness, memStore } from "../test-harness.js";
import { runJoin } from "./join.js";

test("keyline join: a teammate enrolls with a join code and can list members", async () => {
  const h = await harness();
  try {
    // The admin invites; the invite response carries the one-time join code.
    const account = loadAccount(h.deps.store)!;
    const owner = new ApiClient({
      baseUrl: "",
      token: loadCredentials(h.deps.store)!.token,
      fetchImpl: h.fetchImpl,
    });
    const invite = await owner.post<{ joinCode: string }>(
      `/v1/workspaces/${account.workspaceId}/members`,
      { email: "mate@acme.test", role: "member" },
    );

    // The teammate's machine: fresh keystore, joins with the code.
    const mate = { store: memStore(), apiBaseUrl: "", fetchImpl: h.fetchImpl };
    const joined = await runJoin(mate, invite.joinCode);
    assert.equal(joined.workspaceName, "Acme");
    assert.equal(joined.email, "mate@acme.test");
    assert.equal(joined.role, "member");
    assert.equal(loadAccount(mate.store)?.workspaceId, account.workspaceId);

    // The stored session works: the teammate can hit member-level routes.
    const mateApi = new ApiClient({
      baseUrl: "",
      token: loadCredentials(mate.store)!.token,
      fetchImpl: h.fetchImpl,
    });
    const { members } = await mateApi.get<{ members: unknown[] }>(
      `/v1/workspaces/${account.workspaceId}/members`,
    );
    assert.equal(members.length, 2);

    // Joining twice from the same device is refused locally.
    await assert.rejects(() => runJoin(mate, invite.joinCode), /already belongs/);

    // A bogus code is a clean 404.
    const other = { store: memStore(), apiBaseUrl: "", fetchImpl: h.fetchImpl };
    await assert.rejects(() => runJoin(other, "XXXX-XXXX-XXXX"), /unknown, used, or expired/);
  } finally {
    h.cleanup();
  }
});
