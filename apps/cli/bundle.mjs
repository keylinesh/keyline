/**
 * Build the distributable: everything (workspace packages, commander) inlined
 * into dist/keyline.js. One exception since #62: @napi-rs/keyring is a native
 * OPTIONAL dependency (prebuilt per platform) loaded at runtime when present,
 * so it stays external; without it the CLI falls back to the file store.
 */

import { chmodSync } from "node:fs";
import { build } from "esbuild";
import { readFileSync as readPkg } from "node:fs";

const pkgVersion = JSON.parse(readPkg("package.json", "utf8")).version;

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  external: ["@napi-rs/keyring"],
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
  define: { __KEYLINE_VERSION__: JSON.stringify(pkgVersion) },
  logLevel: "warning",
});

chmodSync("dist/keyline.js", 0o755);
