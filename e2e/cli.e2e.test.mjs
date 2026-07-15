/**
 * End-to-end test (#56): the REAL bundled CLI, as a child process, against the
 * REAL API server, over real HTTP. No in-process shortcuts. Two simulated
 * machines (separate HOME dirs, file keystores) walk the whole story:
 *
 *   signup -> link -> push -> pull -> (signed Paddle webhook flips plan to
 *   team) -> invite -> join -> grant -> member pulls -> revoke -> member is
 *   locked out -> audit chain verifies.
 *
 * Prereqs (CI job `e2e` does both): `pnpm build` and
 * `pnpm --filter @keylinesh/cli bundle`.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(repo, "apps/cli/dist/keyline.js");
const SERVER = join(repo, "apps/api/dist/index.js");
const PORT = 4820 + (process.pid % 100); // avoid clashes between local runs
const API = `http://127.0.0.1:${PORT}`;
const WEBHOOK_SECRET = "pdl_ntfset_e2e_secret";

const ENV_CONTENT = "API_KEY=sk_live_e2e\n# comments survive\nDB_URL=postgres://localhost/app\n";

let server;
let work;

/** A simulated machine: its own HOME (file keystore) and project dir. */
function machine(name) {
  const home = join(work, name);
  const project = join(home, "app");
  mkdirSync(project, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home, // windows
    KEYLINE_API_URL: API,
    KEYLINE_KEYSTORE: "file", // never touch the real OS keychain from tests
  };
  const run = async (args, opts = {}) => {
    const { stdout, stderr } = await execFileP(process.execPath, [CLI, ...args], {
      env,
      cwd: opts.cwd ?? project,
    });
    return stdout + stderr;
  };
  run.expectFailure = async (args, opts = {}) => {
    try {
      await execFileP(process.execPath, [CLI, ...args], { env, cwd: opts.cwd ?? project });
    } catch (err) {
      return `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    throw new Error(`expected \`keyline ${args.join(" ")}\` to fail, but it succeeded`);
  };
  return { name, home, project, run };
}

before(async () => {
  for (const bin of [CLI, SERVER]) {
    assert.ok(existsSync(bin), `${bin} missing — run pnpm build && pnpm --filter @keylinesh/cli bundle`);
  }
  work = mkdtempSync(join(tmpdir(), "keyline-e2e-"));
  // The real server entry: no DATABASE_URL = in-memory storage, real HTTP.
  server = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(PORT),
      APP_ENV: "e2e",
      DATABASE_URL: "",
      PADDLE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      RESEND_API_KEY: "", // invite emails stay dormant; join codes still issue
      SENTRY_DSN: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start in 15s")), 15_000);
    server.stdout.on("data", (d) => {
      if (String(d).includes("listening")) (clearTimeout(timer), resolve());
    });
    server.stderr.on("data", (d) => process.stderr.write(d));
    server.on("exit", (code) => reject(new Error(`server exited early (${code})`)));
  });
});

after(() => {
  server?.kill();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("the whole story, over real HTTP with the real binary", async () => {
  const admin = machine("admin");
  const dev = machine("dev");

  // -- signup ----------------------------------------------------------------
  const login = await admin.run([
    "login", "--workspace", "Acme", "--email", "founder@acme.test",
  ]);
  assert.match(login, /Account created and logged in\./);
  const workspaceId = /workspace:\s+(\S+)/.exec(login)[1];

  // -- link + push + pull ----------------------------------------------------
  assert.match(await admin.run(["link", "app", "--env", "prod"]), /Linked this directory/);
  writeFileSync(join(admin.project, ".env"), ENV_CONTENT);
  const push = await admin.run(["push"]);
  assert.match(push, /Created this workspace's encryption key/);
  assert.match(push, /Pushed 2 secrets .*\(version 1\)/);

  rmSync(join(admin.project, ".env"));
  assert.match(await admin.run(["pull"]), /Pulled 2 secrets/);
  assert.equal(readFileSync(join(admin.project, ".env"), "utf8"), ENV_CONTENT,
    "pull round-trips the exact file, comments included");

  // -- billing webhook flips solo -> team (the real signed path) --------------
  const body = JSON.stringify({
    event_id: "evt_e2e_activate",
    event_type: "subscription.activated",
    data: { id: "sub_e2e", status: "active", custom_data: { workspaceId } },
  });
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", WEBHOOK_SECRET).update(`${ts}:${body}`).digest("hex");
  const res = await fetch(`${API}/v1/billing/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "paddle-signature": `ts=${ts};h1=${h1}` },
    body,
  });
  assert.equal(res.status, 200, "signed webhook accepted");

  // -- invite -> join on a second machine -------------------------------------
  const invite = await admin.run(["members", "invite", "dev@acme.test"]);
  const joinCode = /join code: ([A-Z2-9-]+)/.exec(invite)?.[1];
  assert.ok(joinCode, `invite output carries the join code:\n${invite}`);

  assert.match(await dev.run(["join", joinCode]), /Joined Acme as dev@acme\.test/);
  assert.match(await admin.run(["members", "grant", "dev@acme.test", "--env", "prod", "--role", "read"]),
    /Granted dev@acme\.test read on prod/);

  assert.match(await dev.run(["link", "app", "--env", "prod"]), /Linked this directory/);
  assert.match(await dev.run(["pull"]), /Pulled 2 secrets/);
  assert.equal(readFileSync(join(dev.project, ".env"), "utf8"), ENV_CONTENT,
    "the teammate decrypts the same plaintext on their own machine");

  // join codes are one-time
  const reused = machine("mallory");
  assert.match(await reused.run.expectFailure(["join", joinCode]), /error/i);

  // -- revoke locks the member out immediately --------------------------------
  assert.match(await admin.run(["revoke", "dev@acme.test", "--yes"]),
    /Revoked dev@acme\.test/);
  assert.match(await dev.run.expectFailure(["pull"]), /error/i);

  // -- the audit chain survives all of it -------------------------------------
  const verify = await admin.run(["audit", "--verify"]);
  assert.match(verify, /Chain intact: \d+ events verified\./);
  const audit = await admin.run(["audit", "--limit", "100"]);
  for (const expected of ["push", "pull", "revoke"]) {
    assert.ok(audit.includes(expected), `audit log records "${expected}"`);
  }
});
