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

## Environment variables

| Var | What |
|---|---|
| `PADDLE_ENV` | `sandbox` (default) or `live` |
| `PADDLE_API_KEY` | server-side API key, never committed |
| `PADDLE_CLIENT_TOKEN` | client-side token for checkout (#71) |
| `PADDLE_TEAM_PRICE_ID` | the Team price id, printed by paddle:setup |

Local: repo-root `.env`. Production: Vercel env. Code lives in `apps/api/src/billing/`.
