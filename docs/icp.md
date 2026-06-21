# Keyline: Beachhead Persona & ICP (one-pager)

- **Status:** accepted. Beachhead confirmed as **small teams shipping on Vercel** (M0)
- **Date:** 2026-06-20

> Go deep on one persona in one ecosystem instead of "works with everything." This is the single sharpest persona to win first.

## Proposed beachhead: small teams shipping on Vercel

**Who:** 2–6 person product teams building web apps (Next.js / frontend-heavy) who deploy on **Vercel** and share secrets locally today via Slack, a pinned doc, or a passed-around `.env`.

**Why this persona:**
- **Technical + taste-driven.** The "Linear, not Jira" crowd. They feel DX friction and pay for tools that remove it.
- **Sharp, concrete pain.** Vercel manages *deploy-time* env vars well, but **local-dev and cross-tool secret sharing is weak**: teammates still copy `.env` files around by hand. That gap is exactly our wedge.
- **Reachable.** Concentrated in known channels (Next.js / Vercel communities, indie-hacker and frontend Twitter/Discord, Vercel-adjacent newsletters).
- **Fast to value.** They live in the terminal; `install → link → pull` lands immediately.

## Their current workflow (the pain)

1. Vercel holds production env vars.
2. For local dev, someone DMs the `.env` or pastes keys into Slack.
3. New hire onboards → "ping someone for the keys."
4. Someone leaves → nobody rotates; keys linger in chat history.
5. A leak happens → "who had access?" is unanswerable.

## The wedge for this persona

- **`keyline pull` replaces the Slack paste** for local `.env`. Zero new format, under two minutes.
- **`keyline run -- next dev`** injects secrets with no file on disk.
- **Zero-knowledge** answers the "but do we trust another vendor with our keys?" objection: a breach of us isn't a breach of you.
- First integration to go deep on: **Vercel** (sync/import env vars), per `keyline-context.md` §10.

## Why not the alternatives (for the beachhead)

- **Railway / Fly teams.** Strong secondary, very similar pain. Keep as the next ecosystem after Vercel.
- **GitHub Actions / CI-first teams.** Valuable but a different entry point (CI secret injection), wider scope than v1 wants.
- **Non-technical / enterprise.** Wrong DNA. They want SSO, SOC 2, procurement, not a CLI.

## What we'd say to them (positioning)

> "You ship on Vercel. Your prod env vars are handled. But your team still passes the local `.env` around in Slack. Keyline fixes that in one command, and we can't read your keys even if we wanted to."

## Decision

- [x] **Confirmed: Vercel is the beachhead ecosystem** (over Railway / Fly / GitHub Actions). Clearest local-dev gap, reachable community, natural first deep integration.
- [ ] Confirm team-size band (2–6) for the first 10 design-partner conversations. _(open)_

Next: scope the first **Vercel env-sync integration** as a post-MVP issue, and line up 10 Vercel-shipping teams as design partners during beta (M6).
