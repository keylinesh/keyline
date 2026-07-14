/**
 * Build native single-file executables (#67) via Node SEA.
 *
 * Assembly is cross-platform: esbuild a CJS bundle, generate the SEA blob,
 * download each target's official Node binary, inject with postject. Targets
 * today: linux-x64, linux-arm64, win-x64. macOS is deliberately absent until
 * an Apple Developer certificate exists — Gatekeeper makes unsigned Mac
 * binaries useless, and Mac users have npm + Homebrew.
 *
 * Run:  node build-sea.mjs [target ...]     (default: all targets)
 * Out:  dist-bin/keyline-<target>[.exe] + SHA256SUMS
 *
 * Notes:
 * - The SEA entry must be CommonJS; the CJS bundle drops import.meta, so the
 *   optional native keychain can't load inside a SEA binary — the keystore
 *   falls back to the 0600 file store by design.
 * - Signing (Apple notarization / Windows Authenticode) hooks in here per
 *   target once certificates exist. Checksums ship regardless.
 */

import { execFileSync } from "node:child_process";
import { createHash as sha256 } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const NODE_VERSION = process.versions.node; // pin binaries to the build's Node
const TARGETS = {
  "linux-x64": { tarball: `node-v${NODE_VERSION}-linux-x64.tar.gz`, node: "bin/node", out: "keyline-linux-x64" },
  "linux-arm64": { tarball: `node-v${NODE_VERSION}-linux-arm64.tar.gz`, node: "bin/node", out: "keyline-linux-arm64" },
  "win-x64": { tarball: `node-v${NODE_VERSION}-win-x64.zip`, node: "node.exe", out: "keyline-win-x64.exe" },
};

const requested = process.argv.slice(2);
const targets = requested.length ? requested : Object.keys(TARGETS);
for (const t of targets) {
  if (!TARGETS[t]) {
    console.error(`unknown target ${t}; known: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(1);
  }
}

const work = "dist-sea";
const out = "dist-bin";
rmSync(work, { recursive: true, force: true });
rmSync(out, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });

// 1. CJS bundle (SEA entries must be CommonJS).
const pkgVersion = JSON.parse(readFileSync("package.json", "utf8")).version;

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  external: ["@napi-rs/keyring"], // can't ship native modules inside a SEA blob
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: join(work, "keyline-sea.cjs"),
  define: { __KEYLINE_VERSION__: JSON.stringify(pkgVersion) },
  logLevel: "warning",
});

// 2. SEA blob.
writeFileSync(
  join(work, "sea-config.json"),
  JSON.stringify({
    main: join(work, "keyline-sea.cjs"),
    output: join(work, "keyline.blob"),
    disableExperimentalSEAWarning: true,
  }),
);
execFileSync(process.execPath, ["--experimental-sea-config", join(work, "sea-config.json")], {
  stdio: "inherit",
});

// 3. Per target: fetch the official Node binary, inject, checksum.
const sums = [];
for (const name of targets) {
  const target = TARGETS[name];
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${target.tarball}`;
  const archive = join(work, target.tarball);
  console.log(`\n[${name}] fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}) for ${url}`);
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()));

  const extracted = join(work, name);
  mkdirSync(extracted, { recursive: true });
  if (archive.endsWith(".zip")) {
    execFileSync("unzip", ["-q", "-o", archive, "-d", extracted]);
  } else {
    execFileSync("tar", ["-xzf", archive, "-C", extracted]);
  }
  const nodeBin = join(extracted, `node-v${NODE_VERSION}-${name === "win-x64" ? "win-x64" : name}`, target.node);

  const dest = join(out, target.out);
  copyFileSync(nodeBin, dest);
  console.log(`[${name}] injecting SEA blob`);
  execFileSync(
    "npx",
    ["--yes", "postject@1.0.0-alpha.6", dest, "NODE_SEA_BLOB", join(work, "keyline.blob"),
     "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"],
    { stdio: "inherit" },
  );
  chmodSync(dest, 0o755);

  const digest = sha256("sha256").update(readFileSync(dest)).digest("hex");
  sums.push(`${digest}  ${target.out}`);
  console.log(`[${name}] ok: ${dest}`);
}

writeFileSync(join(out, "SHA256SUMS"), sums.join("\n") + "\n");
console.log(`\nwrote ${out}/SHA256SUMS:\n${sums.join("\n")}`);
