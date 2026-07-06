/**
 * `keyline run -- <cmd>` — decrypt in memory and inject secrets straight into a
 * child process's environment (#33). No plaintext ever touches disk.
 *
 * Secrets take precedence over already-exported shell vars (the vault is the
 * source of truth); everything else in the parent environment passes through.
 * The child gets the terminal (stdio inherit). SIGINT/SIGTERM received by the
 * CLI are forwarded to the child, and the child's exit code or fatal signal is
 * reported back so scripts and CI see the real outcome.
 */

import { spawn } from "node:child_process";
import { parseEnv } from "../env-file.js";
import { fetchDecryptedBundle } from "./fetch-bundle.js";
import { resolveSyncContext, type SyncDeps, type SyncInput } from "./sync-context.js";

export interface RunInput extends SyncInput {
  /** The command and its arguments, verbatim. */
  command: string;
  args: string[];
}

export interface RunDeps extends SyncDeps {
  /** Injectable for tests. */
  spawnImpl?: typeof spawn;
}

export interface RunOutcome {
  /** Child exit code; null when the child died from a signal. */
  exitCode: number | null;
  /** Fatal signal (e.g. "SIGTERM"); null on a normal exit. */
  signal: NodeJS.Signals | null;
  secretCount: number;
  label: string;
}

const FORWARDED: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

export async function runRun(deps: RunDeps, input: RunInput): Promise<RunOutcome> {
  const ctx = resolveSyncContext(deps, input);
  const { plaintext } = await fetchDecryptedBundle(ctx);
  const vars = parseEnv(plaintext.toString("utf8"));

  const spawnImpl = deps.spawnImpl ?? spawn;
  const child = spawnImpl(input.command, input.args, {
    stdio: "inherit",
    env: { ...process.env, ...vars },
  });

  // Forward termination signals; with a listener attached the CLI itself stays
  // alive until the child has actually exited, so cleanup order is the child's.
  const forward = (signal: NodeJS.Signals) => {
    if (child.exitCode === null) child.kill(signal);
  };
  const listeners = FORWARDED.map((signal) => {
    const listener = () => forward(signal);
    process.on(signal, listener);
    return [signal, listener] as const;
  });

  try {
    const { exitCode, signal } = await new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", (err: NodeJS.ErrnoException) => {
        reject(
          err.code === "ENOENT"
            ? new Error(`command not found: ${input.command}`)
            : err,
        );
      });
      child.once("close", (code, sig) => resolve({ exitCode: code, signal: sig }));
    });
    return { exitCode, signal, secretCount: Object.keys(vars).length, label: ctx.label };
  } finally {
    for (const [signal, listener] of listeners) process.off(signal, listener);
  }
}
