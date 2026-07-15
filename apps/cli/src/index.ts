/**
 * keyline CLI entrypoint. Builds the commander program (cli.ts) and runs it,
 * turning every failure into words a user can act on (explain.ts) + a
 * non-zero exit. (The shebang is added by the bundle step — bundle.mjs —
 * which produces the executable dist/keyline.js that npm's bin points at.)
 */

import { buildProgram } from "./cli.js";
import { renderError } from "./explain.js";

buildProgram()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    console.error(renderError(err));
    process.exit(1);
  });
