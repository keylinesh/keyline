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

## Checkout (#71)

Settings → Billing. A solo admin gets an "Upgrade to Team" button: the
dashboard fetches `GET /v1/billing/config` (environment + client token +
price id, all public by nature), loads Paddle.js, and opens the overlay
checkout with `customData.workspaceId`. Paddle collects payment. The webhook
flips the plan, and the dashboard polls the workspace until it lands.
Sandbox test card: 4242 4242 4242 4242, any future expiry, any CVC.

## Customer portal (#72)

Settings → Billing → **Manage billing** (team admins). The API creates a
short-lived Paddle portal session (`POST /v1/workspaces/:wid/billing/portal`)
for the stored customer and the browser opens it. Cancel and card changes
happen in Paddle; the resulting webhooks land in the state machine below.

## Subscription lifecycle (#74)

One `workspace_subscriptions` row per subscribed workspace, upserted from
webhook events and guarded by `occurred_at` (out-of-order deliveries never
regress newer state). The plan consequence of each status is explicit:

| Status | Plan | Why |
|---|---|---|
| trialing, active | team | paying (or trialing) |
| past_due | team | grace: Paddle's dunning retries the card |
| paused | solo | the customer chose to stop paying |
| canceled | solo | end of the line; data is kept |

The billing card shows a payment-issue warning during past_due and the trial
end date while trialing (`GET /v1/workspaces/:wid/billing/subscription`,
admin). `paddle_customer_id` is stored for the customer portal (#72).

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
| `CRON_SECRET` | bearer for the daily reconcile cron (#77) |

Local: repo-root `.env`. Production: Vercel env. Code lives in `apps/api/src/billing/`.

## Tax + invoices (#75)

Paddle is the Merchant of Record: it charges, remits VAT/sales tax, and
issues invoices. Verified in sandbox with a real charge (2026-07-14):

- Price is **tax-inclusive**: the customer pays a flat $19.00. For a
  Bulgarian consumer that split into $15.83 net + $3.17 VAT (20%), computed
  by Paddle from the checkout address. Net revenue therefore varies by
  country; the sticker price never does.
- Invoice number issued (`113548-10001`) and PDF retrievable
  (`GET /transactions/:id/invoice`). Paddle emails the receipt to the
  customer. Tax category: `saas`.
- US sales tax: Paddle registers and remits where it has obligations.
  Nothing on our side. Spot-check a US-address test purchase at go-live.

**Income trail (personal tax filing, ADR-0004):** Paddle pays out net
revenue. Monthly: download the transactions + payouts CSVs (Paddle →
Reports) and keep them with the accounting records. The payout report is
the document trail for what landed in the bank account; VAT on sales is
Paddle's, income tax on payouts stays personal.

## Payment lapse (#76)

What happens when a card stops working, end to end:

1. Renewal fails → Paddle moves the subscription to `past_due` and starts
   its retry schedule + dunning emails to the customer (configure under
   **Paddle → Checkout settings → Payment retries / dunning**. On by
   default; review wording at go-live).
2. Our webhook records `past_due`: the workspace **stays on Team** (grace),
   Settings shows the payment-issue banner, `past_due_since` is tracked.
3. The customer fixes the card in the portal (Manage billing) → `active`,
   banner clears. Or Paddle exhausts retries → `canceled` → workspace drops
   to **Solo limits**. Data is never deleted; over-limit members and
   environments stay readable but new invites/environments are blocked by
   entitlements (#49), and audit history windows to 7 days.
4. Cancel-by-choice behaves the same: Team until period end, then Solo.

## Reconciliation (#77)

Webhooks can fail and deploys can lag behind checkouts (both happened).
Paddle is the source of truth for money, so a daily job compares every
Paddle subscription against `workspace_subscriptions` + `workspace.plan`
and heals drift. Every healed plan lands in the audit log
(`billing.reconcile`). Unknown workspaces are reported as orphans, never
applied.

- Production: Vercel cron, daily 06:00 UTC, `GET /v1/billing/reconcile`
  authenticated with the `CRON_SECRET` bearer (set it in Vercel env;
  Vercel attaches it to cron requests automatically).
- Manual / admin view:
  `PADDLE_API_KEY=... DATABASE_URL=... pnpm --filter @keyline/api paddle:reconcile`
  prints every customer's Paddle status, DB status, plan, and what was done.

## Going live (the swap)

1. `PADDLE_ENV=live PADDLE_API_KEY=<live key> pnpm --filter @keyline/api paddle:setup` and `paddle:webhook`.
2. In the live Paddle dashboard: **Checkout → Checkout settings → set the Default payment link** (e.g. `https://keyline.sh/app`). Without it every checkout 400s with `transaction_default_checkout_url_not_set`. Found the hard way in sandbox.
3. Replace in Vercel: `PADDLE_ENV=live`, the live API key + client token, and the printed live `PADDLE_TEAM_PRICE_ID` + `PADDLE_WEBHOOK_SECRET`.

No code changes.
