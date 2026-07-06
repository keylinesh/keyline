import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { harness } from "../test-harness.js";
import { runPush } from "./push.js";
import { runRun } from "./run.js";

const NODE = process.execPath;

test("run injects decrypted secrets into the child env without writing a file", async () => {
  const { deps, dir, cleanup } = await harness();
  try {
    await runPush(deps, { dir });
    rmSync(join(dir, ".env")); // plaintext only lives on the server as ciphertext now

    const out = join(dir, "child-saw.txt");
    const outcome = await runRun(deps, {
      dir,
      command: NODE,
      args: ["-e", `require('fs').writeFileSync(${JSON.stringify(out)}, process.env.API_KEY + '|' + process.env.DB_URL)`],
    });
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.signal, null);
    assert.equal(outcome.secretCount, 2);
    assert.equal(readFileSync(out, "utf8"), "sk_live_x|postgres://localhost/app");
    assert.equal(existsSync(join(dir, ".env")), false, "no plaintext .env was written");
  } finally {
    cleanup();
  }
});

test("run: vault secrets override already-exported shell vars", async () => {
  const { deps, dir, cleanup } = await harness();
  try {
    await runPush(deps, { dir });
    const out = join(dir, "child-saw.txt");
    process.env.API_KEY = "stale-local-value";
    try {
      await runRun(deps, {
        dir,
        command: NODE,
        args: ["-e", `require('fs').writeFileSync(${JSON.stringify(out)}, process.env.API_KEY)`],
      });
    } finally {
      delete process.env.API_KEY;
    }
    assert.equal(readFileSync(out, "utf8"), "sk_live_x");
  } finally {
    cleanup();
  }
});

test("run passes the child's exit code through", async () => {
  const { deps, dir, cleanup } = await harness();
  try {
    await runPush(deps, { dir });
    const outcome = await runRun(deps, { dir, command: NODE, args: ["-e", "process.exit(7)"] });
    assert.equal(outcome.exitCode, 7);
  } finally {
    cleanup();
  }
});

test("run reports the child's fatal signal", async () => {
  const { deps, dir, cleanup } = await harness();
  try {
    await runPush(deps, { dir });
    const outcome = await runRun(deps, {
      dir,
      command: NODE,
      args: ["-e", "process.kill(process.pid, 'SIGTERM'); setInterval(() => {}, 1000)"],
    });
    assert.equal(outcome.signal, "SIGTERM");
    assert.equal(outcome.exitCode, null);
  } finally {
    cleanup();
  }
});

test("run explains an unknown command", async () => {
  const { deps, dir, cleanup } = await harness();
  try {
    await runPush(deps, { dir });
    await assert.rejects(
      () => runRun(deps, { dir, command: "keyline-definitely-not-a-binary", args: [] }),
      /command not found/,
    );
  } finally {
    cleanup();
  }
});

test("run before any push explains what to do", async () => {
  const { deps, dir, cleanup } = await harness();
  try {
    await assert.rejects(
      () => runRun(deps, { dir, command: NODE, args: ["-e", ""] }),
      /keyline push/,
    );
  } finally {
    cleanup();
  }
});
