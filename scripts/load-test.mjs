/**
 * Load test (#56): the three hot paths under concurrency, against the real
 * server over real HTTP.
 *
 *   pull     GET  /v1/environments/:id/bundle   (authed read + audit write)
 *   push     PUT  /v1/environments/:id/bundle   (authed append + audit write)
 *   webhook  POST /v1/billing/webhook           (HMAC verify + processing)
 *
 * Setup uses the real CLI (login, link, push), then hammers the endpoints
 * with autocannon. In-memory storage isolates API-layer throughput from
 * database latency; run against staging for full-stack numbers.
 *
 * Run:  pnpm build && pnpm --filter @keylinesh/cli bundle && node scripts/load-test.mjs
 * Env:  DURATION (s per scenario, default 10), CONNECTIONS (default 25)
 * Exits non-zero on any non-2xx response or when p99 exceeds 250 ms.
 */

import autocannon from "autocannon";
import { execFile, spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(repo, "apps/cli/dist/keyline.js");
const SERVER = join(repo, "apps/api/dist/index.js");
const PORT = 4920 + (process.pid % 100);
const API = `http://127.0.0.1:${PORT}`;
const WEBHOOK_SECRET = "pdl_ntfset_load_secret";
const DURATION = Number(process.env.DURATION ?? 10);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 25);
const P99_BUDGET_MS = 250;

// ---- boot the real server ---------------------------------------------------
const work = mkdtempSync(join(tmpdir(), "keyline-load-"));
const server = spawn(process.execPath, [SERVER], {
  env: {
    ...process.env,
    PORT: String(PORT),
    APP_ENV: "load-test",
    DATABASE_URL: "",
    PADDLE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    RATE_LIMIT_MAX: "1000000", // measure the API, not the limiter
    RESEND_API_KEY: "",
    SENTRY_DSN: "",
  },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("server did not start")), 15_000);
  server.stdout.on("data", (d) => String(d).includes("listening") && (clearTimeout(t), resolve()));
  server.on("exit", (code) => reject(new Error(`server exited early (${code})`)));
});

// ---- seed a workspace with the real CLI -------------------------------------
const home = join(work, "home");
const project = join(home, "app");
mkdirSync(project, { recursive: true });
const cliEnv = { ...process.env, HOME: home, USERPROFILE: home, KEYLINE_API_URL: API, KEYLINE_KEYSTORE: "file" };
const cli = (args) => execFileP(process.execPath, [CLI, ...args], { env: cliEnv, cwd: project });

const { stdout: loginOut } = await cli(["login", "--workspace", "LoadCo", "--email", "load@keyline.test"]);
const workspaceId = /workspace:\s+(\S+)/.exec(loginOut)[1];
await cli(["link", "app", "--env", "prod"]);
writeFileSync(join(project, ".env"), "A=1\nB=2\nC=3\n");
await cli(["push"]);

const token = JSON.parse(readFileSync(join(home, ".keyline/keys/access-token.key"), "utf8")).token;
const envId = JSON.parse(readFileSync(join(project, ".keyline.json"), "utf8")).environmentId;
const auth = { authorization: `Bearer ${token}` };

// Reuse the pushed ciphertext as the PUT body. No baseVersion = unconditional
// append, so concurrent writers don't 409 on each other.
const got = await fetch(`${API}/v1/environments/${envId}/bundle`, { headers: auth });
const { bundle } = await got.json();
const pushBody = JSON.stringify({ bundle: { v: bundle.v, nonce: bundle.nonce, ciphertext: bundle.ciphertext, tag: bundle.tag } });

const signedWebhook = () => {
  const body = JSON.stringify({
    event_id: `evt_${randomUUID()}`,
    event_type: "subscription.activated",
    data: { id: "sub_load", status: "active", custom_data: { workspaceId } },
  });
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", WEBHOOK_SECRET).update(`${ts}:${body}`).digest("hex");
  return { body, sig: `ts=${ts};h1=${h1}` };
};

// ---- scenarios ---------------------------------------------------------------
const scenarios = [
  {
    name: "pull (GET bundle)",
    opts: { url: `${API}/v1/environments/${envId}/bundle`, method: "GET", headers: auth },
  },
  {
    name: "push (PUT bundle)",
    opts: {
      url: `${API}/v1/environments/${envId}/bundle`,
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: pushBody,
    },
  },
  {
    name: "webhook (POST, unique event ids)",
    opts: {
      url: `${API}/v1/billing/webhook`,
      method: "POST",
      setupClient: (client) => {
        client.setHeaders({ "content-type": "application/json" });
        const arm = () => {
          const { body, sig } = signedWebhook();
          client.setHeaders({ "content-type": "application/json", "paddle-signature": sig });
          client.setBody(body);
        };
        arm();
        client.on("response", arm);
      },
    },
  },
];

let failed = false;
const rows = [];
for (const s of scenarios) {
  const result = await autocannon({
    connections: CONNECTIONS,
    duration: DURATION,
    ...s.opts,
  });
  const p99 = result.latency.p99;
  const scenarioFailed = result.non2xx > 0 || result.errors > 0 || p99 > P99_BUDGET_MS;
  failed ||= scenarioFailed;
  rows.push({
    scenario: s.name,
    "req/s": Math.round(result.requests.average),
    "p50 ms": result.latency.p50,
    "p99 ms": p99,
    "non-2xx": result.non2xx,
    errors: result.errors,
    verdict: scenarioFailed ? "FAIL" : "ok",
  });
}

console.table(rows);
console.log(`budget: p99 <= ${P99_BUDGET_MS} ms, zero non-2xx | ${CONNECTIONS} connections, ${DURATION}s per scenario`);

server.kill();
rmSync(work, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
