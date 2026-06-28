#!/usr/bin/env node
/**
 * keyline CLI entrypoint. Builds the commander program (cli.ts) and runs it,
 * turning ApiErrors and other failures into a clean message + non-zero exit.
 */

import { buildProgram } from "./cli.js";
import { ApiError } from "./api-client.js";

buildProgram()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    if (err instanceof ApiError) {
      console.error(`error: ${err.message}${err.status ? ` (${err.status})` : ""}`);
    } else {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
  });
