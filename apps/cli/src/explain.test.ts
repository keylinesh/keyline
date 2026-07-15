import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "./api-client.js";
import { explain, renderError } from "./explain.js";

test("401 explains the session and the fix", () => {
  const e = explain(new ApiError(401, "unauthorized", "token expired"));
  assert.match(e.problem, /session expired/i);
  assert.match(e.fix!, /keyline login/);
});

test("403 tells the user to ask an admin, with the exact command", () => {
  const e = explain(new ApiError(403, "forbidden", "requires read on this environment"));
  assert.match(e.problem, /don't have access/i);
  assert.match(e.fix!, /keyline members grant/);
});

test("plan_limit carries the limit and points at the upgrade", () => {
  const e = explain(new ApiError(402, "plan_limit", "solo allows 1 member", { plan: "solo", limit: 1, current: 1 }));
  assert.match(e.problem, /allows 1/);
  assert.match(e.fix!, /Upgrade to Team/);
});

test("version conflict explains pull-then-push", () => {
  const e = explain(new ApiError(409, "conflict", "baseVersion 3 is behind version 4"));
  assert.match(e.problem, /newer version/i);
  assert.match(e.fix!, /keyline pull/);
});

test("network errors point at connectivity, 5xx at us", () => {
  assert.match(explain(new ApiError(0, "network_error", "cannot reach https://keyline.sh")).fix!, /connection/);
  const server = explain(new ApiError(500, "internal", "boom"));
  assert.match(server.problem, /our side/);
  assert.match(server.fix!, /support@keyline\.sh/);
});

test("hand-written errors and unknown codes pass through untouched", () => {
  assert.equal(explain(new Error("No env file at /x/.env. Create it, or point at one with --file.")).problem,
    "No env file at /x/.env. Create it, or point at one with --file.");
  assert.equal(explain(new ApiError(404, "not_found", "environment not found")).problem, "environment not found");
});

test("renderError formats problem + fix on two lines", () => {
  const out = renderError(new ApiError(401, "unauthorized", "x"));
  assert.match(out, /^error: .*\n  fix: run `keyline login`/);
  assert.equal(renderError(new Error("plain")), "error: plain");
});
