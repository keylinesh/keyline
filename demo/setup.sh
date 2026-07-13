#!/bin/sh
# Demo environment for the VHS recording (demo.tape) — see demo/README.md.
#
# Stands up everything the tape needs, isolated from the machine:
#   - the API server (in-memory storage) on a local port
#   - a scratch HOME (file keystore) and an isolated npm prefix
#   - a project folder with a realistic .env and a tiny server.js
# Writes demo/.demo-env with the exports the tape sources (hidden) on start.

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
# Fixed path (not mktemp): it appears in the recording, so keep it readable.
DEMO_DIR=/tmp/keyline-demo
rm -rf "$DEMO_DIR"
PORT=39184

mkdir -p "$DEMO_DIR/home" "$DEMO_DIR/npm-prefix" "$DEMO_DIR/acme-api"

# A believable .env for the project folder.
cat > "$DEMO_DIR/acme-api/.env" <<'EOF'
# acme-api secrets
DATABASE_URL=postgres://db.internal:5432/acme
OPENAI_API_KEY=sk-proj-DemoNotARealKey
JWT_SECRET=change-me-in-prod
EOF

# What `keyline run` will launch.
cat > "$DEMO_DIR/acme-api/server.js" <<'EOF'
const ok = (v) => (v ? "ok" : "MISSING");
console.log("acme-api starting...");
console.log("  db:     " + ok(process.env.DATABASE_URL));
console.log("  openai: " + ok(process.env.OPENAI_API_KEY));
console.log("  jwt:    " + ok(process.env.JWT_SECRET));
console.log("listening on :3000");
setTimeout(() => process.exit(0), 2200);
EOF

# API server (in-memory, no DATABASE_URL) in the background.
cd "$ROOT/apps/api"
PORT=$PORT nohup node --import tsx src/index.ts > "$DEMO_DIR/api.log" 2>&1 &
echo $! > "$DEMO_DIR/api.pid"

for _ in $(seq 1 40); do
  curl -s -o /dev/null "http://localhost:$PORT/health" && break
  sleep 0.25
done
curl -s -o /dev/null "http://localhost:$PORT/health" || { echo "API did not start; see $DEMO_DIR/api.log" >&2; exit 1; }

# The environment the tape's shell sources before the first visible frame.
cat > "$ROOT/demo/.demo-env" <<EOF
export HOME="$DEMO_DIR/home"
export KEYLINE_KEYSTORE=file
export KEYLINE_API_URL="http://localhost:$PORT"
export NPM_CONFIG_PREFIX="$DEMO_DIR/npm-prefix"
export PATH="$DEMO_DIR/npm-prefix/bin:\$PATH"
export DEMO_DIR="$DEMO_DIR"
cd "$DEMO_DIR"
EOF

echo "demo env ready: $DEMO_DIR (api pid $(cat "$DEMO_DIR/api.pid"), port $PORT)"
echo "  record:   cd $ROOT && vhs demo/demo.tape"
echo "  teardown: demo/teardown.sh"
