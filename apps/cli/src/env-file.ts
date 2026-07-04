/**
 * Local .env handling — parsing, file resolution, a secret count for output
 * messages, and the "is this file gitignored?" safety check.
 *
 * The bundle plaintext is the raw file bytes: comments, ordering, and quoting
 * survive a push/pull round-trip untouched. Parsing happens only locally —
 * for `run` (inject vars into a process, #33) and display counts.
 */

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";

export const DEFAULT_ENV_FILE = ".env";

/**
 * Parse dotenv content into key/value pairs (last assignment wins).
 *
 * Supported: `KEY=value`, an optional `export ` prefix, blank/comment lines,
 * single- and double-quoted values (double quotes expand \n, \r, \t), inline
 * ` # comments` after unquoted values, and `=` inside values. Unquoted values
 * are trimmed. Multi-line values are not supported (one assignment per line).
 */
export function parseEnv(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue!.trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value
        .slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\(["\\])/g, "$1");
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      const comment = value.search(/\s#/);
      if (comment !== -1) value = value.slice(0, comment).trim();
    }
    vars[key!] = value;
  }
  return vars;
}

/** How many distinct secrets a .env holds (for output messages). */
export function countSecrets(content: string): number {
  return Object.keys(parseEnv(content)).length;
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
