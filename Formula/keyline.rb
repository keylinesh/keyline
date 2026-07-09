# Homebrew formula for the keyline CLI.
#
# Lives in this repo as the source of truth; a release copies it (with the
# version + sha256 filled in) into the tap repository, so users can:
#
#   brew tap keyline/keyline https://gitlab.com/resim.boyadzhiev/homebrew-keyline
#   brew install keyline
#
# The npm tarball is a single dependency-free file, so install is trivial.
# See docs/distribution.md for the release steps.

class Keyline < Formula
  desc "Share .env files securely with one command; servers only hold ciphertext"
  homepage "https://keyline.sh"
  url "https://registry.npmjs.org/@keylinesh/cli/-/cli-0.1.0.tgz"
  # Filled in per release: sha256 of the tarball above (see SHA256SUMS).
  sha256 "REPLACE_WITH_RELEASE_SHA256"
  license "MIT"

  depends_on "node"

  def install
    libexec.install Dir["*"]
    (bin/"keyline").write_env_script Formula["node"].opt_bin/"node", libexec/"dist/keyline.js", {}
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/keyline --version")
  end
end
