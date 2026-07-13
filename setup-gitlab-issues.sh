#!/usr/bin/env bash
#
# setup-gitlab-issues.sh
# -----------------------------------------------------------------------------
# Creates the full Keyline backlog on GitLab: milestones, scoped labels, issues.
#
# Usage:
#   export GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx   # PAT with `api` scope
#   ./setup-gitlab-issues.sh
#
# Optional:
#   export GITLAB_PROJECT="resim.boyadzhiev/keyline" # default; namespace/path
#   export GITLAB_HOST="https://gitlab.com"          # default
#
# Safe to re-run: existing milestones/labels/issues (matched by title/name)
# are skipped rather than duplicated.
#
# Requires: bash, curl, jq
# -----------------------------------------------------------------------------

GITLAB_HOST="${GITLAB_HOST:-https://gitlab.com}"
GITLAB_PROJECT="${GITLAB_PROJECT:-resim.boyadzhiev/keyline}"
API="${GITLAB_HOST}/api/v4"

# --- preflight --------------------------------------------------------------
if [ -z "${GITLAB_TOKEN:-}" ]; then
  echo "ERROR: GITLAB_TOKEN is not set. Create a PAT with 'api' scope at:"
  echo "  ${GITLAB_HOST}/-/user_settings/personal_access_tokens"
  echo "Then: export GITLAB_TOKEN=glpat-..."
  exit 1
fi
command -v jq   >/dev/null 2>&1 || { echo "ERROR: jq not found.";   exit 1; }
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl not found."; exit 1; }

AUTH=(-H "PRIVATE-TOKEN: ${GITLAB_TOKEN}")
PROJECT_ENC="$(printf '%s' "$GITLAB_PROJECT" | sed 's#/#%2F#g')"

# Verify token + project access
PROJ_JSON="$(curl -s "${AUTH[@]}" "${API}/projects/${PROJECT_ENC}")"
PROJ_NAME="$(printf '%s' "$PROJ_JSON" | jq -r '.path_with_namespace // empty')"
if [ -z "$PROJ_NAME" ]; then
  echo "ERROR: could not access project '${GITLAB_PROJECT}'."
  echo "Response: $(printf '%s' "$PROJ_JSON" | jq -r '.message // .error // .' 2>/dev/null)"
  exit 1
fi
echo "==> Target project: ${PROJ_NAME}"
echo

# --- labels -----------------------------------------------------------------
echo "==> Creating labels..."
create_label() { # name color
  local name="$1" color="$2"
  local body; body="$(jq -n --arg n "$name" --arg c "$color" '{name:$n,color:$c}')"
  local resp; resp="$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" \
    -H "Content-Type: application/json" \
    -X POST "${API}/projects/${PROJECT_ENC}/labels" --data "$body")"
  case "$resp" in
    201) echo "    + label: $name" ;;
    409) echo "    = label exists: $name" ;;
    *)   echo "    ! label '$name' -> HTTP $resp" ;;
  esac
}
create_label "area::crypto"      "#8e44ad"
create_label "area::backend"     "#1f78d1"
create_label "area::cli"         "#16a085"
create_label "area::dashboard"   "#e67e22"
create_label "area::payments"    "#c0392b"
create_label "area::infra"       "#34495e"
create_label "area::growth"      "#f39c12"
create_label "area::compliance"  "#2c3e50"
create_label "type::feature"     "#44ad8e"
create_label "type::chore"       "#95a5a6"
create_label "type::docs"        "#5cb85c"
create_label "type::security"    "#cc0000"
create_label "type::infra"       "#428bca"
create_label "priority::high"    "#cc0000"
create_label "priority::medium"  "#e67e22"
create_label "priority::low"     "#aaaaaa"
echo

# --- milestones -------------------------------------------------------------
echo "==> Creating milestones..."
create_milestone() { # title description
  local title="$1" desc="$2"
  local existing; existing="$(curl -s "${AUTH[@]}" -G \
    --data-urlencode "title=${title}" \
    "${API}/projects/${PROJECT_ENC}/milestones" | jq -r 'length')"
  if [ "${existing:-0}" -gt 0 ]; then
    echo "    = milestone exists: $title"
    return
  fi
  local body; body="$(jq -n --arg t "$title" --arg d "$desc" '{title:$t,description:$d}')"
  curl -s "${AUTH[@]}" -H "Content-Type: application/json" \
    -X POST "${API}/projects/${PROJECT_ENC}/milestones" --data "$body" >/dev/null \
    && echo "    + milestone: $title"
}
create_milestone "M0 · Foundations & Validation" "Repo setup, stack ADRs, MVP scope, waitlist + analytics, beachhead persona."
create_milestone "M1 · Crypto Core"              "The riskiest assumption: zero-knowledge encryption, envelope keys, recovery, external review."
create_milestone "M2 · Backend API & Data Model" "Data model, device auth, push/pull ciphertext, RBAC, tamper-evident audit log, infra."
create_milestone "M3 · CLI"                       "The simplicity wedge: login/link/push/pull/run/rotate/revoke/audit, sub-2-min DX, distribution."
create_milestone "M4 · Web Dashboard"             "Auth, workspace/project/env management, members, audit viewer, onboarding."
create_milestone "M5 · Payments (Paddle MoR)"      "Paddle as Merchant of Record (ADR-0004): catalog, trials, customer portal, webhooks, subscription state machine, entitlements."
create_milestone "M6 · Trust, Compliance & Launch" "Public crypto doc, legal, SOC 2 readiness, observability, beta, public launch."
echo

# Cache milestones for id lookup
MILESTONES_JSON="$(curl -s "${AUTH[@]}" --data-urlencode "per_page=100" -G \
  "${API}/projects/${PROJECT_ENC}/milestones")"
milestone_id() { # title -> id (or empty)
  printf '%s' "$MILESTONES_JSON" | jq -r --arg t "$1" \
    'map(select(.title==$t)) | (.[0].id // empty)'
}

# --- issues -----------------------------------------------------------------
echo "==> Creating issues..."
ISSUE_COUNT=0
issue() { # title milestone-title labels   (description on stdin)
  local title="$1" ms="$2" labels="$3"
  local desc; desc="$(cat)"

  # skip if an exact-title issue already exists
  local found; found="$(curl -s "${AUTH[@]}" -G \
    --data-urlencode "search=${title}" --data-urlencode "in=title" \
    "${API}/projects/${PROJECT_ENC}/issues" \
    | jq -r --arg t "$title" '[.[] | select(.title==$t)] | length')"
  if [ "${found:-0}" -gt 0 ]; then
    echo "    = issue exists: $title"
    return
  fi

  local mid; mid="$(milestone_id "$ms")"
  local body
  if [ -n "$mid" ]; then
    body="$(jq -n --arg t "$title" --arg d "$desc" --arg l "$labels" --argjson m "$mid" \
      '{title:$t,description:$d,labels:$l,milestone_id:$m}')"
  else
    body="$(jq -n --arg t "$title" --arg d "$desc" --arg l "$labels" \
      '{title:$t,description:$d,labels:$l}')"
  fi
  local resp; resp="$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" \
    -H "Content-Type: application/json" \
    -X POST "${API}/projects/${PROJECT_ENC}/issues" --data "$body")"
  if [ "$resp" = "201" ]; then
    ISSUE_COUNT=$((ISSUE_COUNT+1))
    echo "    + [$ms] $title"
  else
    echo "    ! issue '$title' -> HTTP $resp"
  fi
}

# ============================ M0 · Foundations =============================
issue "Replace boilerplate README with real project doc" \
  "M0 · Foundations & Validation" "type::docs,area::growth,priority::high" <<'DESC'
The README is still the default GitLab template. Replace it with the real pitch, drawn from `keyline-context.md`.

**Acceptance criteria**
- [ ] One-liner, problem, who it's for, how it works (3 commands)
- [ ] Zero-knowledge claim stated honestly + link to encryption doc (M1)
- [ ] Local dev / monorepo setup instructions
- [ ] Status badge + license
DESC

issue "Set up ADR folder and record the tech-stack decision" \
  "M0 · Foundations & Validation" "type::docs,priority::high" <<'DESC'
Create `docs/decisions/` and capture key architecture decisions as ADRs.

**Acceptance criteria**
- [ ] ADR template added
- [ ] ADR-001: Full TypeScript stack (Node CLI, Node API, React dashboard, Postgres)
- [ ] ADR-002: zero-knowledge boundary (does plaintext ever touch the browser?)
DESC

issue "Define MVP scope, success metrics and non-goals" \
  "M0 · Foundations & Validation" "type::docs,area::growth,priority::high" <<'DESC'
Write down what ships in v1 (M1–M6) and, crucially, what does NOT.

**Acceptance criteria**
- [ ] Explicit in-scope feature list per surface (crypto, API, CLI, dashboard, payments)
- [ ] Success metrics (waitlist signups, demo completion %, time-to-first-pull)
- [ ] Non-goals list to prevent scope creep
DESC

issue "Configure GitLab: templates, branch protection, CI gating" \
  "M0 · Foundations & Validation" "type::chore,area::infra,priority::medium" <<'DESC'
Set up the project for collaboration.

**Acceptance criteria**
- [ ] Issue + merge-request description templates
- [ ] Protected `main`; MRs require pipeline pass + review
- [ ] Default labels confirmed (created by this script)
DESC

issue "Scaffold the TypeScript monorepo (pnpm workspaces)" \
  "M0 · Foundations & Validation" "type::chore,area::infra,priority::high" <<'DESC'
Create a single repo with shared packages.

**Acceptance criteria**
- [ ] Workspaces: `packages/crypto`, `packages/shared`, `apps/cli`, `apps/api`, `apps/web`
- [ ] TypeScript strict mode, ESLint + Prettier, shared tsconfig
- [ ] Root scripts: `build`, `lint`, `typecheck`, `test`
DESC

issue "CI pipeline skeleton (lint, typecheck, test, build)" \
  "M0 · Foundations & Validation" "type::infra,area::infra,priority::medium" <<'DESC'
GitLab CI that runs on every MR.

**Acceptance criteria**
- [ ] `.gitlab-ci.yml` with install/lint/typecheck/test/build stages
- [ ] Caches node_modules / pnpm store
- [ ] Fails the pipeline on any stage error
DESC

issue "Wire landing page CTAs to a waitlist + analytics" \
  "M0 · Foundations & Validation" "type::feature,area::growth,priority::high" <<'DESC'
`index.html` markets a product that doesn't exist yet. Convert CTAs to capture demand.

**Acceptance criteria**
- [ ] "Start trial" / "Free for solo devs" buttons capture email to a waitlist
- [ ] Privacy-friendly analytics (page views, CTA clicks)
- [ ] Confirmation state / thank-you after signup
DESC

issue "Pick beachhead persona + write a one-page ICP" \
  "M0 · Foundations & Validation" "type::docs,area::growth,priority::medium" <<'DESC'
Go deep on one persona instead of "works with everything".

**Acceptance criteria**
- [ ] Chosen persona + ecosystem (e.g. small teams shipping on Vercel)
- [ ] Their current secret-sharing pain + the wedge
- [ ] First-integration target derived from the persona
DESC

# ============================ M1 · Crypto Core ============================
issue "Write public encryption design doc + threat model" \
  "M1 · Crypto Core" "type::docs,type::security,area::crypto,priority::high" <<'DESC'
This is both a trust asset and a forcing function for getting the crypto right. Write it BEFORE finalizing code.

**Acceptance criteria**
- [ ] Primitives, key hierarchy, and data flow diagrams
- [ ] Threat model: what an attacker with the full DB cannot do
- [ ] Explicit statement of what the server can and cannot see
DESC

issue "Crypto lib: AES-256-GCM secret-bundle encrypt/decrypt" \
  "M1 · Crypto Core" "type::feature,area::crypto,priority::high" <<'DESC'
Core symmetric encryption for a set of secrets.

**Acceptance criteria**
- [ ] Encrypt/decrypt a bundle with AES-256-GCM (random nonce, AAD)
- [ ] Versioned ciphertext envelope format
- [ ] No secret material logged or thrown in errors
DESC

issue "Workspace key derivation (KDF) design + implementation" \
  "M1 · Crypto Core" "type::feature,type::security,area::crypto,priority::high" <<'DESC'
Derive the workspace key from a customer-controlled secret; the plaintext key never reaches the server.

**Acceptance criteria**
- [ ] KDF chosen + justified (e.g. Argon2id / scrypt params)
- [ ] Deterministic derivation given the workspace secret
- [ ] Parameters documented in the encryption doc
DESC

issue "Device keypair generation + secure local key storage" \
  "M1 · Crypto Core" "type::feature,type::security,area::crypto,priority::high" <<'DESC'
Each device gets an asymmetric keypair used for envelope wrapping.

**Acceptance criteria**
- [ ] Generate per-device keypair on first login
- [ ] Private key stored in OS keychain where available, file fallback with correct perms
- [ ] Public key registered with the server
DESC

issue "Per-member envelope encryption (wrap/unwrap workspace key)" \
  "M1 · Crypto Core" "type::feature,type::security,area::crypto,priority::high" <<'DESC'
Wrap the workspace key to each member's device public key so add/revoke re-wraps rather than re-encrypts everything.

**Acceptance criteria**
- [ ] Wrap workspace key to a member public key
- [ ] Unwrap with the device private key
- [ ] Adding a member produces a new wrapped key without touching ciphertext bundles
DESC

issue "Recovery: admin-device recovery flow" \
  "M1 · Crypto Core" "type::feature,type::security,area::crypto,priority::high" <<'DESC'
A workspace must be recoverable via any active admin device when a member loses theirs.

**Acceptance criteria**
- [ ] Admin device can re-wrap the workspace key to a new device
- [ ] Flow documented + tested end-to-end
- [ ] Clear failure messaging when no admin device is available
DESC

issue "Recovery: sealed recovery file (export/import)" \
  "M1 · Crypto Core" "type::feature,type::security,area::crypto,priority::medium" <<'DESC'
Optional customer-held recovery artifact for the "all devices lost" case.

**Acceptance criteria**
- [ ] Export an encrypted sealed recovery file
- [ ] Import restores workspace access
- [ ] Docs are explicit: lost key + no recovery = unrecoverable (by design)
DESC

issue "Crypto test vectors + property/fuzz tests" \
  "M1 · Crypto Core" "type::chore,type::security,area::crypto,priority::high" <<'DESC'
Lock the crypto behavior down with deterministic vectors and randomized tests.

**Acceptance criteria**
- [ ] Known-answer test vectors committed
- [ ] Round-trip property tests (encrypt→decrypt) for random inputs
- [ ] Tamper tests: modified ciphertext/nonce/AAD fails to decrypt
DESC

issue "Decide and document the zero-knowledge boundary" \
  "M1 · Crypto Core" "type::docs,type::security,area::crypto,priority::high" <<'DESC'
Resolve the core tension: a web dashboard that shows/edits secret VALUES can break the ZK claim.

**Acceptance criteria**
- [ ] Decision: are plaintext values CLI-only, or does the browser ever decrypt?
- [ ] Implications for the dashboard scope (M4) written down
- [ ] Marketing claim language adjusted to match reality
DESC

issue "Engage external security review of the crypto design" \
  "M1 · Crypto Core" "type::security,area::crypto,priority::high" <<'DESC'
The ZK claim must be verifiable, not asserted. Get a third party to review the design.

**Acceptance criteria**
- [ ] Reviewer/firm shortlisted + engaged
- [ ] Design doc + prototype shared
- [ ] Findings triaged into follow-up issues
DESC

# ====================== M2 · Backend API & Data Model =====================
issue "Database schema + migrations" \
  "M2 · Backend API & Data Model" "type::feature,area::backend,priority::high" <<'DESC'
Model the domain. Server stores ciphertext, wrapped keys, metadata, audit events — never plaintext.

**Acceptance criteria**
- [ ] Tables: users, workspaces, projects, environments, members, secret_bundles, wrapped_keys, audit_events
- [ ] Migration tooling wired in
- [ ] No column ever holds a plaintext secret or master key
DESC

issue "Auth: device login + scoped access tokens" \
  "M2 · Backend API & Data Model" "type::feature,type::security,area::backend,priority::high" <<'DESC'
Authenticate devices and issue least-privilege tokens.

**Acceptance criteria**
- [ ] Device login + public-key registration
- [ ] Short-lived, scoped access tokens
- [ ] Token revocation supported
DESC

issue "API: workspace / project / environment CRUD" \
  "M2 · Backend API & Data Model" "type::feature,area::backend,priority::high" <<'DESC'
Management endpoints for the resource hierarchy.

**Acceptance criteria**
- [ ] Create/list/update/delete workspaces, projects, environments
- [ ] Authorization enforced per resource
- [ ] Input validation + consistent error format
DESC

issue "API: push / pull encrypted secret bundles" \
  "M2 · Backend API & Data Model" "type::feature,area::backend,priority::high" <<'DESC'
The core data path. Server only ever sees ciphertext.

**Acceptance criteria**
- [ ] Push stores a versioned ciphertext bundle for an environment
- [ ] Pull returns the latest bundle + wrapped key for the device
- [ ] Optimistic concurrency / versioning to avoid clobbering
DESC

issue "API: member management + per-environment RBAC" \
  "M2 · Backend API & Data Model" "type::feature,type::security,area::backend,priority::high" <<'DESC'
Scope who can read/write which environment.

**Acceptance criteria**
- [ ] Invite/list/remove members
- [ ] Per-environment roles (e.g. read vs write vs admin)
- [ ] Authorization checks covered by tests
DESC

issue "Tamper-evident audit log (hash-chained, append-only)" \
  "M2 · Backend API & Data Model" "type::feature,type::security,area::backend,priority::high" <<'DESC'
Every read, write, and denied attempt is recorded so the integrity claim holds.

**Acceptance criteria**
- [ ] Append-only events with who/what/when
- [ ] Hash-chained so tampering is detectable
- [ ] Verification routine + test
DESC

issue "Server-side revoke + rotate orchestration" \
  "M2 · Backend API & Data Model" "type::feature,type::security,area::backend,priority::high" <<'DESC'
Cut access immediately and support secret rotation.

**Acceptance criteria**
- [ ] Revoke a member: drop their wrapped keys + tokens at once
- [ ] Rotate a single secret produces a new bundle version
- [ ] Both actions emit audit events
DESC

issue "Rate limiting, input validation, security headers" \
  "M2 · Backend API & Data Model" "type::security,area::backend,priority::medium" <<'DESC'
Baseline API hardening.

**Acceptance criteria**
- [ ] Per-token + per-IP rate limits
- [ ] Strict request validation on all endpoints
- [ ] Security headers + TLS-only enforced
DESC

issue "Infra: provision Postgres + hosting + IaC" \
  "M2 · Backend API & Data Model" "type::infra,area::infra,priority::high" <<'DESC'
Stand up the runtime environment as code.

**Acceptance criteria**
- [ ] Managed Postgres provisioned
- [ ] API hosting chosen + deploy pipeline
- [ ] Infra defined as code (reproducible)
DESC

issue "Infra: staging + prod environments, secrets, TLS" \
  "M2 · Backend API & Data Model" "type::infra,area::infra,priority::high" <<'DESC'
Separate, secured environments.

**Acceptance criteria**
- [ ] Distinct staging + prod with isolated data
- [ ] Infra secrets stored in a real secrets manager (not env files)
- [ ] TLS everywhere, automated certs
DESC

issue "Observability baseline: logs, metrics, error tracking" \
  "M2 · Backend API & Data Model" "type::infra,area::infra,priority::medium" <<'DESC'
You can't operate a trust product blind.

**Acceptance criteria**
- [ ] Structured logs (never logging secret material)
- [ ] Core metrics + dashboards
- [ ] Error tracking with alerting
DESC

# ================================ M3 · CLI ================================
issue "CLI scaffold + config + credential storage" \
  "M3 · CLI" "type::feature,area::cli,priority::high" <<'DESC'
Foundation for all commands.

**Acceptance criteria**
- [ ] CLI framework wired (commander/oclif), `--help`, versioning
- [ ] Config + credential storage (OS keychain where possible)
- [ ] Consumes `packages/crypto` for all crypto ops
DESC

issue "Commands: keyline login + link" \
  "M3 · CLI" "type::feature,area::cli,priority::high" <<'DESC'
Authenticate a device and bind a directory to a workspace/environment.

**Acceptance criteria**
- [ ] `keyline login` registers the device
- [ ] `keyline link <project> --env <env>` persists the binding
- [ ] Friendly errors for not-logged-in / unknown project
DESC

issue "Commands: keyline push / pull" \
  "M3 · CLI" "type::feature,area::cli,priority::high" <<'DESC'
The core loop: encrypt local `.env` up, decrypt down.

**Acceptance criteria**
- [ ] `push` encrypts local `.env` and uploads ciphertext
- [ ] `pull` downloads + decrypts to a local `.env`
- [ ] Never writes plaintext anywhere unexpected; respects `.gitignore`
DESC

issue "Command: keyline run -- <cmd>" \
  "M3 · CLI" "type::feature,area::cli,priority::high" <<'DESC'
Inject secrets into a process without writing a file.

**Acceptance criteria**
- [ ] Decrypts in-memory and injects env vars into the child process
- [ ] No plaintext file touches disk
- [ ] Passes through exit code + signals
DESC

issue "Commands: keyline rotate / revoke" \
  "M3 · CLI" "type::feature,area::cli,priority::high" <<'DESC'
Operational safety commands.

**Acceptance criteria**
- [ ] `rotate <KEY>` rotates a single secret
- [ ] `revoke <user@>` cuts a member's access immediately
- [ ] Both reflect in the audit log
DESC

issue "Commands: keyline audit / members" \
  "M3 · CLI" "type::feature,area::cli,priority::medium" <<'DESC'
Visibility + access management from the terminal.

**Acceptance criteria**
- [ ] `audit --env <env>` views/exports the log
- [ ] `members` lists + scopes members per environment
- [ ] Output is readable + scriptable (e.g. `--json`)
DESC

issue "First-run DX polish: install -> link -> pull under 2 minutes" \
  "M3 · CLI" "type::chore,area::cli,priority::high" <<'DESC'
The sub-2-minute first run is the core differentiator. Treat it as a feature.

**Acceptance criteria**
- [ ] Measured: clean machine to first successful `pull` < 2 min
- [ ] Zero new concepts required in the happy path
- [ ] Friction points logged + fixed
DESC

issue "Distribution: npm + Homebrew + curl|sh + signed binaries" \
  "M3 · CLI" "type::infra,area::cli,priority::medium" <<'DESC'
Make installation effortless and trustworthy.

**Acceptance criteria**
- [ ] Published to npm
- [ ] Homebrew tap + `curl | sh` installer
- [ ] Binaries signed; checksums published
DESC

issue "Record the product demo (GIF/video)" \
  "M3 · CLI" "type::docs,area::growth,priority::high" <<'DESC'
The demo is your best marketing asset — record it once the happy path is solid.

**Acceptance criteria**
- [ ] Screen recording of install -> link -> pull -> run
- [ ] Embedded on the landing page
- [ ] Under ~60 seconds
DESC

# ============================ M4 · Web Dashboard ===========================
issue "Dashboard scaffold (React/TS) + auth/session" \
  "M4 · Web Dashboard" "type::feature,area::dashboard,priority::high" <<'DESC'
Web app foundation, respecting the ZK boundary decided in M1.

**Acceptance criteria**
- [ ] React + TypeScript app scaffolded
- [ ] Auth/session integrated with the API
- [ ] Honors the plaintext-in-browser decision from the ZK boundary issue
DESC

issue "Workspace / project / environment management UI" \
  "M4 · Web Dashboard" "type::feature,area::dashboard,priority::high" <<'DESC'
Manage the resource hierarchy from the browser.

**Acceptance criteria**
- [ ] Create/list/edit workspaces, projects, environments
- [ ] Metadata only (no plaintext values unless ZK decision allows)
- [ ] Reflects API authorization
DESC

issue "Member management UI (invite, scope, revoke)" \
  "M4 · Web Dashboard" "type::feature,area::dashboard,priority::high" <<'DESC'
Team admin in the browser.

**Acceptance criteria**
- [ ] Invite members, set per-environment scope
- [ ] Revoke access in one click
- [ ] Shows pending vs active members
DESC

issue "Audit log viewer" \
  "M4 · Web Dashboard" "type::feature,area::dashboard,priority::medium" <<'DESC'
Answer "who touched prod?" at a glance.

**Acceptance criteria**
- [ ] Filterable by environment, member, action
- [ ] Shows tamper-evident verification status
- [ ] Export (CSV/JSON)
DESC

issue "Account, settings & onboarding flow" \
  "M4 · Web Dashboard" "type::feature,area::dashboard,priority::medium" <<'DESC'
First-time setup + account management.

**Acceptance criteria**
- [ ] Guided onboarding (create workspace -> install CLI -> first pull)
- [ ] Account + profile settings
- [ ] Entry point to billing (M5)
DESC

# ==================== M5 · Payments (Paddle MoR) — ADR-0004 ====================
issue "Paddle setup: products + prices (Solo \$0, Team \$19 flat)" \
  "M5 · Payments (Paddle MoR)" "type::feature,area::payments,priority::high" <<'DESC'
Model the catalog in Paddle (sandbox first). Paddle is our Merchant of Record (ADR-0004).

**Acceptance criteria**
- [ ] Paddle sandbox: product + price for Team (\$19/mo flat); Solo stays free (no checkout)
- [ ] Sandbox + live API keys handled via env (never committed)
- [ ] Paddle product/price ids mapped to internal plans (entitlements)
DESC

issue "Paddle checkout + 14-day trial subscription creation" \
  "M5 · Payments (Paddle MoR)" "type::feature,area::payments,priority::high" <<'DESC'
Let a team start a Team subscription with a trial via Paddle checkout.

**Acceptance criteria**
- [ ] Paddle checkout (hosted/overlay) creates a Team subscription with a 14-day trial
- [ ] Trial start/end reflected internally (workspace.plan flips via webhooks)
- [ ] No card required for Solo
DESC

issue "Paddle customer portal integration" \
  "M5 · Payments (Paddle MoR)" "type::feature,area::payments,priority::medium" <<'DESC'
Self-serve billing management via Paddle's customer portal.

**Acceptance criteria**
- [ ] Customers can cancel + update payment method via the Paddle portal
- [ ] Portal link surfaced in dashboard Settings (billing section)
- [ ] Portal changes reconcile via webhooks
DESC

issue "Paddle webhook handler: signature verification + idempotency" \
  "M5 · Payments (Paddle MoR)" "type::feature,type::security,area::payments,priority::high" <<'DESC'
The backbone of payment correctness.

**Acceptance criteria**
- [ ] Verify Paddle webhook signatures (Paddle-Signature) on every event
- [ ] Idempotent processing so retried events don't double-apply
- [ ] Handles subscription.created/activated/updated/canceled + transaction.completed/payment_failed
DESC

issue "Subscription state machine + grace period" \
  "M5 · Payments (Paddle MoR)" "type::feature,area::payments,priority::high" <<'DESC'
Model the lifecycle explicitly, driven by Paddle events. Dunning emails + retries are Paddle's job.

**Acceptance criteria**
- [ ] States: trialing -> active -> past_due -> canceled (+ transitions from Paddle events)
- [ ] Grace period on past_due before downgrade
- [ ] Access consequences per state are explicit + tested
DESC

issue "Entitlements service: enforce seats, env caps, audit retention" \
  "M5 · Payments (Paddle MoR)" "type::feature,area::payments,priority::high" <<'DESC'
Gate plan limits at the API, not just the UI.

**Acceptance criteria**
- [ ] Team: <=10 members (no per-seat), unlimited envs, unlimited audit
- [ ] Solo: 1 dev, <=2 environments, 7-day audit history
- [ ] Limits enforced server-side with clear errors
DESC

issue "MoR tax + invoicing: verify Paddle handles VAT/receipts end-to-end" \
  "M5 · Payments (Paddle MoR)" "type::feature,area::payments,priority::medium" <<'DESC'
As Merchant of Record, Paddle charges and remits VAT/sales tax and issues invoices — verify it.

**Acceptance criteria**
- [ ] Correct Paddle tax category configured for SaaS
- [ ] Test purchases confirm invoices/receipts reach the customer (EU VAT + US cases)
- [ ] Payout reports archived as the income trail for personal tax filing
DESC

issue "Payment lapse: dunning config + downgrade-on-cancel logic" \
  "M5 · Payments (Paddle MoR)" "type::feature,area::payments,priority::high" <<'DESC'
Decide what happens to data + access when payment lapses.

**Acceptance criteria**
- [ ] Paddle payment retry / dunning configured
- [ ] On cancel/expiry: downgrade to Solo limits (don't destroy data silently)
- [ ] Member experience + notifications documented
DESC

issue "Billing reconciliation + internal admin tooling" \
  "M5 · Payments (Paddle MoR)" "type::chore,area::payments,priority::medium" <<'DESC'
Detect + fix drift between Paddle and our DB.

**Acceptance criteria**
- [ ] Periodic reconciliation job (Paddle subscription state vs workspace.plan)
- [ ] Internal admin view of a customer's subscription + entitlements
- [ ] Alert on mismatches
DESC

issue "keyline.sh legal pages: terms, privacy, refund policy (Paddle verification)" \
  "M5 · Payments (Paddle MoR)" "type::feature,area::web,priority::high" <<'DESC'
Paddle domain verification requires the site to show what is sold and under which terms.

**Acceptance criteria**
- [ ] Terms of service page
- [ ] Privacy policy page
- [ ] Refund policy page (Paddle requires a stated policy)
- [ ] Footer links from keyline.sh + /app
DESC

# ==================== M6 · Trust, Compliance & Launch ====================
issue "Publish encryption doc, security posture, vuln disclosure" \
  "M6 · Trust, Compliance & Launch" "type::docs,type::security,area::compliance,priority::high" <<'DESC'
Make the trust claims public + verifiable.

**Acceptance criteria**
- [ ] Encryption design doc published publicly
- [ ] Security posture page (TLS, tokens, SOC 2 status stated honestly)
- [ ] Vulnerability disclosure policy + contact
DESC

issue "Legal: ToS, Privacy Policy, DPA" \
  "M6 · Trust, Compliance & Launch" "type::docs,area::compliance,priority::high" <<'DESC'
Table stakes for a B2B security product.

**Acceptance criteria**
- [ ] Terms of Service
- [ ] Privacy Policy
- [ ] Data Processing Agreement available to customers
DESC

issue "Start SOC 2 Type II readiness program" \
  "M6 · Trust, Compliance & Launch" "type::chore,area::compliance,priority::medium" <<'DESC'
Begin the long-lead compliance work early; state status honestly meanwhile.

**Acceptance criteria**
- [ ] Gap assessment completed
- [ ] Core policies + controls drafted
- [ ] Evidence collection / monitoring tooling chosen
DESC

issue "End-to-end + load testing across CLI / API / dashboard" \
  "M6 · Trust, Compliance & Launch" "type::chore,area::backend,priority::high" <<'DESC'
Prove the whole system works together under load.

**Acceptance criteria**
- [ ] E2E happy-path: signup -> link -> push/pull -> revoke -> audit
- [ ] Load test the push/pull + webhook paths
- [ ] Critical paths covered in CI
DESC

issue "Private beta program + feedback loop" \
  "M6 · Trust, Compliance & Launch" "type::chore,area::growth,priority::high" <<'DESC'
Validate with real teams before public launch.

**Acceptance criteria**
- [ ] Beta cohort recruited from the waitlist
- [ ] Structured feedback + telemetry on first-run success
- [ ] Top issues triaged into the backlog
DESC

issue "Public launch: pricing page wired to live checkout" \
  "M6 · Trust, Compliance & Launch" "type::feature,area::growth,priority::high" <<'DESC'
Flip from waitlist to live product.

**Acceptance criteria**
- [ ] Pricing page connected to live Paddle checkout
- [ ] Launch announcement + channels ready
- [ ] On-call + monitoring in place for launch day
DESC

# --- summary ----------------------------------------------------------------
echo
echo "==> Done. Created ${ISSUE_COUNT} new issue(s) this run."
echo "    View them: ${GITLAB_HOST}/${GITLAB_PROJECT}/-/issues"
echo "    Milestones: ${GITLAB_HOST}/${GITLAB_PROJECT}/-/milestones"
