#!/bin/sh
# keyline installer — https://keyline.sh/install
#
#   curl -fsSL https://keyline.sh/install | sh
#
# Installs the keyline CLI from npm (the package is a single dependency-free
# file). Needs Node 20+. Safe to re-run; upgrades in place.

set -eu

say() { printf '%s\n' "$*"; }
fail() { printf 'keyline install: %s\n' "$*" >&2; exit 1; }

# --- Node 20+ ---------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js 20+ is required but wasn't found.

  Install it first:
    macOS:            brew install node
    Linux (Debian):   https://deb.nodesource.com
    anywhere:         https://nodejs.org

  Then re-run:  curl -fsSL https://keyline.sh/install | sh"
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] 2>/dev/null || \
  fail "Node.js 20+ is required (found $(node -v)). Upgrade node, then re-run."

command -v npm >/dev/null 2>&1 || fail "npm wasn't found next to node — install npm, then re-run."

# --- Install ----------------------------------------------------------------
say "Installing keyline from npm..."
if npm install -g @keyline/cli >/dev/null 2>&1; then
  :
else
  say "npm install -g needs elevated permissions on this system; retrying with sudo."
  command -v sudo >/dev/null 2>&1 || fail "npm -g failed and sudo is unavailable. Try: npm config set prefix ~/.npm-global"
  sudo npm install -g @keyline/cli >/dev/null
fi

command -v keyline >/dev/null 2>&1 || \
  fail "installed, but 'keyline' is not on your PATH. Check: npm config get prefix"

say ""
say "keyline $(keyline --version) installed."
say ""
say "Get started:"
say "  keyline login     # two questions and you're in"
say "  cd your-project"
say "  keyline link      # binds this folder"
say "  keyline push      # your .env, encrypted on your machine"
