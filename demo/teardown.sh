#!/bin/sh
# Stop the demo API server and remove the scratch directories.
set -eu
for d in /tmp/keyline-demo /tmp/keyline-demo.*; do
  [ -d "$d" ] || continue
  [ -f "$d/api.pid" ] && kill "$(cat "$d/api.pid")" 2>/dev/null || true
  rm -rf "$d"
done
rm -f "$(cd "$(dirname "$0")" && pwd)/.demo-env"
echo "demo env removed"
