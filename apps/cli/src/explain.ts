/**
 * Turn any error into words a user can act on. Every command's failure funnels
 * through here (index.ts), so an unexplained ApiError never reaches the
 * terminal as "forbidden (403)".
 *
 * Shape: a one-line problem, then an optional `fix:` line with the exact next
 * command. Voice: short, human, no blame.
 */

import { ApiError } from "./api-client.js";

export interface Explained {
  problem: string;
  fix?: string;
}

export function explain(err: unknown): Explained {
  if (err instanceof ApiError) return explainApi(err);
  return { problem: err instanceof Error ? err.message : String(err) };
}

function explainApi(err: ApiError): Explained {
  switch (err.code) {
    case "network_error":
      return {
        problem: err.message.replace("cannot reach", "Can't reach the Keyline API at") + ".",
        fix: "check your internet connection, then try again. Status: https://keyline.sh",
      };
    case "redirect_error":
      return { problem: err.message, fix: "unset KEYLINE_API_URL, or point it at https://keyline.sh" };
    case "plan_limit": {
      const d = (err.details ?? {}) as { limit?: number; current?: number };
      const at = d.limit !== undefined ? ` The Solo plan allows ${d.limit}.` : "";
      return {
        problem: `${err.message}${at}`,
        fix: "upgrade to Team ($19 flat) in the dashboard: Settings, Upgrade to Team",
      };
    }
    case "conflict":
      if (err.message.includes("version")) {
        return {
          problem: "Someone pushed a newer version while you were working.",
          fix: "run `keyline pull` to get it, re-apply your change, then push again",
        };
      }
      return { problem: err.message };
    case "rate_limited":
      return { problem: "Slow down: too many requests in the last minute.", fix: "wait a moment and try again" };
    case "validation_error":
      return { problem: err.message };
  }
  switch (err.status) {
    case 401:
      return { problem: "Your session expired.", fix: "run `keyline login` to sign back in" };
    case 403:
      return {
        problem: `You don't have access to do that. ${err.message}.`,
        fix: "ask a workspace admin to grant it: `keyline members grant <your-email> --env <env> --role read`",
      };
    case 404:
      return { problem: err.message };
    case 429:
      return { problem: "Slow down: too many requests in the last minute.", fix: "wait a moment and try again" };
  }
  if (err.status >= 500) {
    return {
      problem: "The Keyline API hit a problem on our side. Your data is safe.",
      fix: "try again in a minute. Still broken? Tell us: support@keyline.sh",
    };
  }
  return { problem: err.message };
}

/** Render for the terminal: problem first, then an indented fix line. */
export function renderError(err: unknown): string {
  const { problem, fix } = explain(err);
  return fix ? `error: ${problem}\n  fix: ${fix}` : `error: ${problem}`;
}
