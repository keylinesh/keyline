/**
 * Build the single-file distributable: everything (workspace packages,
 * commander) inlined into dist/keyline.js. This is the only file the npm
 * package ships, so `npm i -g keyline` installs zero dependencies.
 */

import { chmodSync } from "node:fs";
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist/keyline.js",
  banner: {
    // Shebang, plus a CJS-interop shim for any dependency that esbuild
    // converts using require() semantics inside the ESM output.
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __cr } from 'node:module';",
      "const require = __cr(import.meta.url);",
    ].join("\n"),
  },
  logLevel: "warning",
});

chmodSync("dist/keyline.js", 0o755);
