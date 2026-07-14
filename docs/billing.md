# Billing (Paddle)

Paddle is our Merchant of Record ([ADR-0004](decisions/0004-paddle-merchant-of-record.md)). Paddle sells to the customer, charges VAT/sales tax, and issues invoices. We keep subscription state and flip `workspace.plan`.

## Catalog

One paid product. Solo is free and never touches Paddle.

| Plan | Paddle | Price |
|---|---|---|
| Solo | none | $0 |
| Team | product + price, `custom_data.plan = "team"` | $19/mo flat, 14-day trial |

The `custom_data.plan` field is the mapping back to internal plans. Webhooks (#73) read it instead of hardcoded ids.

## Setup

```sh
PADDLE_API_KEY=... PADDLE_ENV=sandbox pnpm --filter @keyline/api paddle:setup
```

Idempotent. Re-run any time. It prints the product and price ids.

## Webhooks (#73)

Paddle drives our subscription state via `POST /v1/billing/webhook` (public,
authenticated by the `Paddle-Signature` HMAC, not a token). The handler:

1. Verifies the signature over the raw body (5-minute freshness window).
2. Records the event once in `billing_events` (unique event id = idempotency).
3. On `subscription.*`: flips `workspace.plan` using `custom_data.workspaceId`
   set at checkout. `trialing`/`active` → team, `canceled` → solo.
   `past_due`/`paused` change nothing yet (grace period is #74).
4. Every plan change lands in the workspace audit log (`billing.plan_change`).

Register the destination (idempotent, prints the signing secret):

```sh
PADDLE_API_KEY=... pnpm --filter @keyline/api paddle:webhook [url]
```

The route returns 503 until `PADDLE_WEBHOOK_SECRET` is set.

**Vercel gotcha:** the signature must be computed over the exact wire bytes.
Set `NODEJS_HELPERS=0` in the Vercel project env so the platform doesn't
consume and re-serialize request bodies (see `api/[[...route]].ts`).

## Environment variables

| Var | What |
|---|---|
| `PADDLE_ENV` | `sandbox` (default) or `live` |
| `PADDLE_API_KEY` | server-side API key, never committed |
| `PADDLE_CLIENT_TOKEN` | client-side token for checkout (#71) |
| `PADDLE_TEAM_PRICE_ID` | the Team price id, printed by paddle:setup |
| `PADDLE_WEBHOOK_SECRET` | signing secret, printed by paddle:webhook |
| `NODEJS_HELPERS` | `0` on Vercel, keeps raw bodies for signatures |

Local: repo-root `.env`. Production: Vercel env. Code lives in `apps/api/src/billing/`.

## Going live (the swap)

1. `PADDLE_ENV=live PADDLE_API_KEY=<live key> pnpm --filter @keyline/api paddle:setup` and `paddle:webhook`.
2. Replace in Vercel: `PADDLE_ENV=live`, the live API key + client token, and the printed live `PADDLE_TEAM_PRICE_ID` + `PADDLE_WEBHOOK_SECRET`.

No code changes.
