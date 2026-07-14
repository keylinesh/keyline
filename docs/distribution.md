# Distribution (#37)

How the CLI ships. The npm package is **`@keylinesh/cli`** (the command is still
`keyline`) — a single dependency-free file (esbuild bundle,
`apps/cli/bundle.mjs`), so installs are fast and the supply-chain surface is
one artifact.

> Why scoped: npm's typosquat protection rejects the bare name `keyline`
> ("too similar to existing package byline"), discovered on first publish.
> The scope requires the npm org `keylinesh` to exist and the CI token to have
> publish rights in it.

## Channels

| Channel | Command | Status |
|---|---|---|
| curl \| sh | `curl -fsSL keyline.sh/install | sh` | `install.sh` in this repo, served at `/install` (vercel.json) |
| npm | `npm i -g @keylinesh/cli` | published by CI on version tags |
| Homebrew | `brew tap keyline/keyline <tap-repo> && brew install keyline` | formula in `Formula/keyline.rb`; needs the tap repo (one-time, below) |
| Native binaries | GitLab release → build-binaries artifacts | linux-x64/arm64 + win-x64 per release, UNSIGNED (#67); checksums attached. macOS + signing wait for certs (below) |

## Cutting a release

1. Bump `version` in `apps/cli/package.json` (e.g. `0.1.1`).
2. Merge to main, then tag and push: `git tag v0.1.1 && git push origin v0.1.1`.
3. CI (`publish-npm`) rebuilds, verifies tag == package version, publishes to
   npm, and stores `SHA256SUMS` + the tarball as permanent artifacts; the
   `gitlab-release` job creates the GitLab release.
4. Homebrew: copy `Formula/keyline.rb` into the tap repo, set `url` to the new
   tarball and `sha256` from `SHA256SUMS`.

## One-time setup (owner)

- **npm**: create the owner account, mint an *automation* token, add it as a
  masked **and protected** CI/CD variable `NPM_TOKEN` (release tags `v*` are
  protected, so protected variables reach them). Create the **org `keylinesh`**
  — the `@keylinesh` scope is what makes the package name publishable.
- **Homebrew tap**: create a public repo named `homebrew-keyline` (GitLab works:
  `brew tap keyline/keyline https://gitlab.com/<owner>/homebrew-keyline`), put
  `Formula/keyline.rb` in it.
- The `/install` route ships with the next Vercel deploy of main — nothing to
  configure.

## Native binaries (#67)

`apps/cli/build-sea.mjs` assembles single-file executables with Node SEA: a
CJS esbuild bundle becomes a SEA blob, injected (postject) into each target's
official Node binary. CI (`build-binaries`) runs it on every version tag and
keeps the binaries + SHA256SUMS as permanent artifacts.

Current targets: linux-x64, linux-arm64, win-x64 — **unsigned**. Windows shows
a SmartScreen warning; verify the checksum. Inside a SEA binary the native
keychain can't load, so the keystore uses the 0600 file store.

**Signing (when certificates exist):** hooks go in build-sea.mjs after
injection. macOS: Apple Developer Program ($99/yr) → `codesign` +
`notarytool`, then darwin-x64/arm64 join the target list. Windows: an
Authenticode cert or Azure Trusted Signing (~$10/mo) → `signtool`/`osslsigncode`.
Until then, npm + Homebrew + curl|sh stay the first-class channels.

## Verifying an install

```bash
curl -fsSL keyline.sh/install | sh
keyline --version
# checksums: GitLab release → publish-npm artifacts → SHA256SUMS
shasum -a 256 "$(npm root -g)/@keylinesh/cli/dist/keyline.js"
```
