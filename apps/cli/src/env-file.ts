/**
 * Local .env handling for push/pull — file resolution, a secret count for
 * output messages, and the "is this file gitignored?" safety check.
 *
 * The bundle plaintext is the raw file bytes: comments, ordering, and quoting
 * survive a push/pull round-trip untouched. Parsing only happens locally, for
 * display counts (and later for `rotate`, #34).
 */

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";

export const DEFAULT_ENV_FILE = ".env";

/** Count assignment lines (KEY=... at the start of a line, comments excluded). */
export function countSecrets(content: string): number {
  let count = 0;
  for (const line of content.split("\n")) {
    if (/^\s*(export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line)) count++;
  }
  return count;
}

/**
 * Whether git ignores `filePath`. Returns null when the answer is unknowable
 * (not a git repo, git not installed) — callers warn only on an explicit false.
 */
export function isGitIgnored(filePath: string): boolean | null {
  try {
    execFileSync("git", ["check-ignore", "-q", filePath], {
      cwd: dirname(filePath),
      stdio: "ignore",
    });
    return true;
  } catch (err) {
    // Exit 1 = "not ignored"; anything else (128 = not a repo, ENOENT) = unknown.
    return (err as { status?: number }).status === 1 ? false : null;
  }
}

/** A warning line when a plaintext .env is (or would be) committed to git. */
export function gitignoreWarning(filePath: string, check: typeof isGitIgnored = isGitIgnored): string | null {
  return check(filePath) === false
    ? `warning: ${filePath} is not gitignored. Add it to .gitignore so plaintext secrets never land in git.`
    : null;
}
