# Observability

Baseline so the API can be operated without flying blind (#29).

## Structured logs

One JSON object per line to stdout — ingested by Vercel (and any log pipeline).
Each request emits a `request` log with: `requestId`, `method`, `path`, matched
`route`, `status`, `ms`, and the actor `memberId` / `deviceId` / `workspaceId`
when authenticated.

**Never logs secret material.** Request bodies are never passed to the logger,
and a redactor (`observability/logger.ts`) blanks any field whose name looks
sensitive — `authorization`, `token`, `ciphertext`, `nonce`, `tag`, `eph`,
`answer`, `challenge`, `*privatekey*`, `*kdfsalt*`, `cookie`, … — recursively.
This is enforced by a test that asserts a live request's bearer token never
appears in the logs.

Set `KEYLINE_LOG_SILENT=1` to mute logs (used by the test suite).

## Metrics

In-process registry (`observability/metrics.ts`) exposed at **`GET /metrics`** in
Prometheus format:

- `http_requests_total{method,route,status}`
- `http_request_duration_ms_sum{method,route}` + `..._count`

Routes use the matched pattern (`/v1/environments/:id/bundle`) to keep label
cardinality bounded. On serverless these reset per cold start, so the durable
signal is the structured logs; `/metrics` is for the long-running Node
deployment and external scrapers.

**Dashboards** are built on top of these in the platform: Vercel Observability
(log-based metrics + charts) for the serverless deploy, or Prometheus/Grafana
scraping `/metrics` for a self-hosted deploy. Suggested panels: request rate,
error rate (status >= 500), p50/p95 latency per route, auth failures (401/403),
rate-limit hits (429).

## Error tracking + alerting

Unhandled errors funnel through `app.onError` → `reportError`, which logs a
structured `error` event with the error name + stack (context redacted) and
returns a generic 500 (no internals leaked).

For production alerting, forward errors to **Sentry**: set `SENTRY_DSN` in the
environment and initialize the SDK at the process edge (`index.ts` / the Vercel
function). Alert rules (e.g. new error type, error-rate spike, any 5xx on
`/api/v1/*`) are configured in Sentry. Kept out of the app code so there's no
hard dependency and tests need no DSN.

## What to watch first

- 5xx rate on `/api/v1/*` (correctness/availability)
- 401/403 spikes (auth problems or abuse)
- 429 rate (rate-limit tuning)
- p95 latency on push/pull (`/v1/environments/:id/bundle`)
- DB errors in logs (Neon connectivity)
