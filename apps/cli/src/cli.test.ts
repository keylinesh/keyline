import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProgram } from "./cli.js";

test("registers the full command surface", () => {
  const names = buildProgram().commands.map((c) => c.name());
  for (const expected of [
    "login", "status", "link", "push", "pull", "run", "rotate", "revoke", "audit", "members",
  ]) {
    assert.ok(names.includes(expected), `missing command: ${expected}`);
  }
});

test("exposes a version", () => {
  // commander's version() getter returns the configured version string.
  const v = buildProgram().version();
  assert.ok(typeof v === "string" && v.length > 0);
});

test("--version prints the version and exits via exitOverride", () => {
  const program = buildProgram().exitOverride();
  let out = "";
  program.configureOutput({ writeOut: (s) => (out += s) });
  assert.throws(
    () => program.parse(["--version"], { from: "user" }),
    (err: Error & { code?: string }) => err.code === "commander.version",
  );
  assert.match(out, /\d+\.\d+\.\d+/);
});

test("unknown command is rejected", () => {
  const program = buildProgram().exitOverride();
  program.configureOutput({ writeErr: () => {} });
  assert.throws(() => program.parse(["bogus"], { from: "user" }));
});
