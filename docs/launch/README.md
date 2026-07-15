# Public Launch Runbook

> GitLab issue: **M6 #58 — Public launch: pricing page wired to live checkout.**
> This is the kit; the launch itself happens when the beta exit criteria in
> [docs/beta](../beta/README.md) say go. The issue stays open until launch day.

## Phase 0: prerequisites (before picking a date)

- [ ] Beta exit review passed (see beta exit criteria).
- [ ] External security review engaged or consciously waived for launch (#18).
      The /security page states the honest status either way.
- [ ] **Live Paddle account approved** (founder: paddle.com, business
      verification takes days, start early; sandbox account is separate).
- [ ] Founder has run `keyline push` on the real workspace. We do not launch
      a product we do not use.

## Phase 1: the live billing swap (T-1 day)

Exactly [docs/billing.md "Going live"](../billing.md), summarized:

1. `PADDLE_ENV=live PADDLE_API_KEY=<live key> pnpm --filter @keyline/api paddle:setup`
   then `paddle:webhook` (destination: `https://keyline.sh/v1/billing/webhook`).
2. Live dashboard: set the **Default payment link** (`https://keyline.sh/app`).
   Skipping this 400s every checkout; found the hard way in sandbox.
3. Also in the live dashboard: review dunning email wording (Checkout
   settings → Payment retries).
4. Swap five Vercel env vars: `PADDLE_ENV=live`, live API key, live client
   token, live `PADDLE_TEAM_PRICE_ID`, live `PADDLE_WEBHOOK_SECRET`. Redeploy.
5. **Verify with a real card** (founder's own): checkout at $19, invoice PDF
   arrives, workspace flips to team, portal opens, then refund from the
   Paddle dashboard (the refunds page promises 14 days; eat our own policy).
6. Spot-check a US-address purchase for tax handling.

## Phase 2: the site flip (launch morning)

One small MR, prepared in advance and merged when ready:

- The six `data-waitlist` CTAs on the landing page become "Get started",
  linking to `#how` (the install + first-push walkthrough).
- The waitlist modal stays in the code path (`/api/waitlist` keeps working
  for stragglers with old tabs), just no longer promoted.
- Hero subline drops any "beta" wording.

## Phase 3: announce

Order matters: warm audiences first, cold last, all in one morning (CET).

1. **Waitlist email** (personal, from support@keyline.sh, BCC):

   > **Subject:** Keyline is live
   >
   > You joined the Keyline waitlist, so you get the short version first:
   > it's live. Share your .env with your team, encrypted before it leaves
   > your laptop. Solo is free, Team is $19 flat.
   >
   >     curl -fsSL keyline.sh/install | sh
   >     keyline login
   >
   > I read every reply. Tell me where it annoys you.
   >
   > {founder}

2. **Beta teams**: personal thank-you + ask for a public mention if they
   liked it. Their words carry more weight than ours.

3. **Show HN** (weekday, 08:00-10:00 US Eastern):

   > **Title:** Show HN: Keyline — share .env files, encrypted before they
   > leave your laptop
   >
   > First comment (from the founder account): what it is in three
   > sentences, the zero-knowledge design doc link, the public
   > anchors repo link, honest current limits (no SSO, CLI-first,
   > one-person company), and the stack. Answer everything, fast,
   > for the first 6 hours. Do not argue; thank and log.

4. **X/Twitter thread**: 5 posts. The hook is the anchors repo — "our audit
   log is publicly witnessed; if we rewrite history, you can prove it."
   Screenshots of the terminal flow, not the dashboard.

5. **Reddit** r/devops, r/selfhosted (honest "I built this" flair), only
   where self-promotion rules allow.

## Phase 4: launch-week watch (on-call = founder)

Daily, ~15 minutes, log anomalies as issues:

| Check | How |
| --- | --- |
| Errors | Sentry Issues (new since yesterday) |
| Funnel | `pnpm --filter @keyline/api beta:metrics` |
| Money vs DB | `paddle:reconcile` manual run + the 06:00 UTC cron result |
| Anchors | daily commit landed in keyline-anchors |
| Support | support@keyline.sh inbox, reply same day |
| Infra | Vercel deployment status, Neon dashboard |

Escalation: SEV levels + steps in
[incident-response.md](../compliance/policies/incident-response.md). Rollback
for a bad deploy is Vercel instant rollback; rollback for billing is
`PADDLE_ENV` back to sandbox (checkout pauses, nothing breaks: entitlements
degrade to solo gracefully and reconciliation heals on re-enable).

## What "launched" means

- [ ] A stranger can pay $19 with a real card and invite a teammate with no
      founder involvement.
- [ ] Announcement posts are live and answered.
- [ ] First week of daily checks logged with no open SEV1/SEV2.

Then: close #58, close M6, and update the /security page if the review
status changed.
