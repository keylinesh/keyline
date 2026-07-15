# Private Beta Program

> GitLab issue: **M6 #57 — Private beta program + feedback loop.**
> This directory is the kit. Running the beta is founder work; the issue stays
> open until a real cohort has been through it.

## Goal

Before public launch, watch 5 to 10 real teams hit the aha moment (first push)
and the product promise (a teammate pulls the same secrets) without help. Every
place they stumble is a launch blocker found cheaply.

## The funnel we measure

Run against production (no tracking added; this reads metadata and audit
events we already hold):

```
DATABASE_URL=... pnpm --filter @keyline/api beta:metrics
```

It prints, per workspace and in total: reached first push, pushed within 24h
(first-run success), second member joined, teammate pulled, active in the last
7 days. Run it before each beta check-in and paste the summary into #57.

## Recruiting the cohort

Sources, in order of signal quality:

1. **Waitlist** (live on the landing page, stored in the `waitlist` table).
2. Direct outreach: dev friends with 2 to 5 person teams, especially anyone
   currently sharing `.env` over Slack.
3. Communities where the pain is stated, not guessed: "how do you share env
   files" threads.

Offer: free Team plan for the beta period plus 6 months, direct line to the
founder, and their pain points fixed first. Ask: 30 minutes of honest feedback
and permission to watch their funnel row.

## Invite email (send personally, not in bulk)

> **Subject:** Keyline beta: share .env with your team, encrypted
>
> Hi {name},
>
> I'm building Keyline, a zero-knowledge secrets manager for small dev teams.
> You push your .env with one command, teammates pull it decrypted on their
> machines. Our servers only ever hold ciphertext. Even we can't read your
> secrets, and that claim is verifiable, not asserted: keyline.sh/security.
>
> I'd like you in the private beta. Team plan free for the beta and 6 months
> after. In exchange I want your honest feedback, especially where it annoys
> you.
>
> Getting in takes two minutes:
>
>     curl -fsSL keyline.sh/install | sh
>     keyline login
>     keyline link && keyline push
>
> Reply and I'll be your support channel, personally.
>
> {founder}

## Structured feedback

Ask each team these six, one week in. Log answers as issues (see triage):

1. Walk me through your first 10 minutes. Where did you hesitate?
2. Did your teammate get in without you helping them? What happened?
3. What did you expect Keyline to do that it didn't?
4. What almost stopped you from trying it?
5. Would you pay $19/month for this at your team size? Why or why not?
6. What would you tell a friend Keyline is?

Plus the funnel row: did their answers match what the data says they did?

## Triage

- Every stumble becomes a GitLab issue labeled **beta-feedback**, one issue
  per problem, with the team's words quoted (anonymized).
- Weekly: rank by (teams affected x funnel stage blocked). The top three go
  into the next milestone; everything else waits. Resist fixing by recency.
- A beta exit review closes #57: funnel summary, top issues shipped or
  scheduled, and a go / no-go for #58 (public launch).

## Exit criteria for the beta

- At least 5 teams reached "teammate pulled".
- First-run success (push within 24h) at 70% or better for the last cohort.
- No open beta-feedback issue that blocks the funnel.
