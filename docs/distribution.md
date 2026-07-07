# Distribution (#37)

How the CLI ships. The npm package is **`keyline`** — a single dependency-free
file (esbuild bundle, `apps/cli/bundle.mjs`), so installs are fast and the
supply-chain surface is one artifact.

## Channels

| Channel | Command | Status |
|---|---|---|
| curl \| sh | `curl -fsSL keyline.sh/install | sh` | `install.sh` in this repo, served at `/install` (vercel.json) |
| npm | `npm i -g keyline` | published by CI on version tags |
| Homebrew | `brew tap keyline/keyline <tap-repo> && brew install keyline` | formula in `Formula/keyline.rb`; needs the tap repo (one-time, below) |
| Signed native binaries | — | deferred: backlog #67 (needs signing certs); checksums ship today |

## Cutting a release

1. Bump `version` in `apps/cli/package.json` (e.g. `0.1.1`).
2. Merge to main, then tag and push: `git tag v0.1.1 && git push origin v0.1.1`.
3. CI (`publish-npm`) rebuilds, verifies tag == package version, publishes to
   npm, and stores `SHA256SUMS` + the tarball as permanent artifacts; the
   `gitlab-release` job creates the GitLab release.
4. Homebrew: copy `Formula/keyline.rb` into the tap repo, set `url` to the new
   tarball and `sha256` from `SHA256SUMS`.

## One-time setup (owner)

- **npm**: create the `keyline` package owner account, mint an *automation*
  token, add it as a masked CI/CD variable `NPM_TOKEN`. First publish claims
  the name (it was free as of 2026-07-07).
- **Homebrew tap**: create a public repo named `homebrew-keyline` (GitLab works:
  `brew tap keyline/keyline https://gitlab.com/<owner>/homebrew-keyline`), put
  `Formula/keyline.rb` in it.
- The `/install` route ships with the next Vercel deploy of main — nothing to
  configure.

## Verifying an install

```bash
curl -fsSL keyline.sh/install | sh
keyline --version
# checksums: GitLab release → publish-npm artifacts → SHA256SUMS
shasum -a 256 "$(npm root -g)/keyline/dist/keyline.js"
```
