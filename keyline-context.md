# Keyline — Project Context

> A simple, hosted, zero-knowledge secrets manager for small dev teams.
> Working doc — captures positioning, decisions, risks, and next steps so you can continue locally.

_Last updated: 2026-07-11. Status: M0–M4 shipped (crypto, API, CLI on npm/brew, web dashboard at keyline.sh/app); M5 payments next. Live status in README._

---

## 1. One-liner

**Keyline lets a small team share `.env` files securely with one command — encrypted so completely that not even Keyline can read the keys.**

Tagline candidates:
- "We host your secrets. We can't read them." _(current hero line)_
- "Ship secrets, not screenshots."
- "Your `.env`, sealed before it leaves your laptop."

---

## 2. The problem

Small teams (2–10 devs) share secrets in ways that are convenient and dangerous:

- API keys and DB creds pasted into **Slack / DMs** → permanent, searchable, visible to anyone you offboard.
- **Shared drives / pinned docs** drift out of date → half the team runs the wrong key.
- **`.env` committed to the repo** → one bad `git push` from a public leak.
- **No audit trail** → after a leak, "who saw what, when?" is unanswerable.

Everyone knows this is bad. The friction is that the "correct" alternatives feel heavy for a 3-person team.

---

## 3. Target audience

- **Primary:** 2–10 person dev teams currently sharing secrets over Slack / shared drives.
- **Secondary (free tier funnel):** solo developers and side projects.
- Psychographic: technical, CLI-comfortable, value simplicity and taste (the "Linear, not Jira" crowd). Price-sensitive, high churn risk, may graduate to platform-native tooling.

---

## 4. Positioning & differentiators

The category is **crowded and trust-heavy**. "Secrets manager, but small" is not enough. The two defensible wedges:

### a) Zero-knowledge encryption (the trust wedge)
- Encryption/decryption happen **client-side**; servers only ever hold ciphertext.
- Workspace key is derived from a secret the customer controls; it never reaches Keyline servers.
- Marketing claim: **"A breach of us is not a breach of you."**
- ⚠️ This claim must be **true and publicly verifiable** (published encryption design), or it's a liability. This is the single most important thing to get right.

### b) `.env`-native, one-command CLI (the simplicity wedge)
- No new format to learn. If the app reads env vars today, you're done.
- Core loop: `keyline pull` writes a local `.env`; `keyline run` injects vars at startup.
- "CLI feels like magic" is the retention hook for this persona.

Supporting features: per-environment access control, tamper-evident audit log, instant revoke/rotate, git-safe by design.

---

## 5. Competitive landscape

| Competitor | What they are | Where they leave a gap |
|---|---|---|
| **Doppler** | Closest direct competitor; mature, has free tier | Can feel heavy/enterprise-flavored for tiny teams |
| **Infisical** | Open-source, well-funded, same "stop sharing .env in Slack" message | OSS self-host overhead; not zero-knowledge by default |
| **HashiCorp Vault** | Enterprise heavyweight | Massive overkill / ops burden for small teams |
| **1Password** | Has a developer/secrets product | Password-manager-first; less `.env`/CLI-native |
| **Cloud-native (AWS/GCP/Azure secrets)** | Free-ish if already on that cloud | Locked to one cloud; clunky local-dev DX |
| **Platform built-ins (Vercel/Netlify/Railway)** | Env management where you deploy | Tied to one platform; weak for cross-tool/local sharing |
| **DIY (SOPS + KMS, git-crypt)** | Free, powerful | Setup + maintenance friction; no audit UI |

**The buyer's real question is not "better than Slack?" — it's "why this instead of Doppler's free tier or Infisical's OSS?"** The answer must be: radically simpler + genuinely zero-knowledge + honest flat pricing.

---

## 6. Pricing

| Plan | Price | For | Includes |
|---|---|---|---|
| **Solo** | $0 forever | Individual devs / side projects | 1 dev, ≤2 environments, full CLI + zero-knowledge, 7-day audit history |
| **Team** | **$19/mo flat** | 2–10 person teams | ≤10 members (no per-seat), unlimited envs/projects, per-env access, unlimited audit log, revoke/rotate, SSO-ready |

Pricing notes / open tensions:
- A **free tier is necessary** because competitors offer one — a paid-only product loses on first comparison.
- Flat $19 is a clean "no per-seat math" hook, **but** it caps expansion revenue exactly when a customer becomes valuable (10 → 30 people). Consider a third tier above 10 seats later.
- Undercutting hard on a *security* product can read as "cheap." Trust and integrations matter more than $0 vs $19 for this category.

---

## 7. CLI surface (draft)

```
keyline login                      # auth the device
keyline link <project> --env prod  # bind a directory to workspace/env
keyline push                       # encrypt local .env → workspace
keyline pull                       # decrypt workspace → local .env
keyline run -- <cmd>               # inject vars into a process, no file written
keyline rotate <KEY>               # rotate a single secret
keyline revoke <user@>             # cut a member's access immediately
keyline audit --env prod           # view / export the log
keyline members                    # list + scope members per environment
```

Design goal: the first-run experience (install → link → pull) should take **under two minutes** and require learning **zero new concepts**.

---

## 8. Architecture notes (zero-knowledge)

High-level intent (not yet a final crypto spec — get a security review before shipping):

- **Client-side encryption** with AES-256-GCM per secret bundle.
- **Workspace key** derived from a workspace secret the customer controls (e.g. via a KDF). Server never sees the plaintext key.
- **Member access:** envelope encryption — wrap the workspace key per member device public key, so adding/revoking a member re-wraps rather than re-encrypts everything.
- **Server stores:** ciphertext, wrapped keys, metadata, audit events. Never plaintext secrets or the master key.
- **Recovery:** since we can't reset the key, offer (a) recovery via any active admin device, and (b) an optional sealed recovery file the customer stores themselves. Be explicit that lost-key-with-no-recovery = unrecoverable (that's the point).
- **Audit log** should be tamper-evident (e.g. append-only / hash-chained) so the integrity claim holds up.

Security posture to build toward: TLS everywhere, scoped access tokens, SOC 2 Type II (in progress is fine to state honestly), **publicly documented encryption design** so claims are verifiable, not just asserted.

---

## 9. Key risks / honest caveats

1. **Trust is everything and we have none yet.** A breach here hands attackers a whole production keychain. SOC 2 + credible, explainable crypto are near table-stakes. This is the hardest part of launching.
2. **The "no code changes" promise is slightly overstated.** Teams stop committing `.env` and instead run `keyline pull` / `keyline run`. Their *app code* doesn't change, but their *workflow* does — say this honestly.
3. **Simplicity is easy to copy, hard to defend.** Incumbents can add a "lite" mode. Defensibility has to come from taste, DX, and the zero-knowledge guarantee combined.
4. **The target segment has the least money and highest churn.** Small teams fold, get acquired, or graduate to platform-native tooling. Plan for expansion paths.
5. **The free-vs-paid squeeze.** Competing paid against a free incumbent — the free Solo tier and a sharp DX story are the answer.

---

## 10. Open questions / decisions to make

- [ ] **Name** — "Keyline" is a working choice; check trademark + domain availability (.com / .sh / .dev) before committing.
- [ ] Final encryption spec + external security review.
- [ ] Recovery UX — how exactly does an admin-device or sealed-file recovery flow work?
- [ ] Which **one ecosystem** to integrate deepest first (Vercel? Railway? GitHub Actions?) as the beachhead.
- [ ] Self-host / OSS option to counter Infisical? (Affects trust + positioning.)
- [ ] Pricing: add a >10-seat tier now or later?
- [ ] What's the single sharpest persona to win first (e.g. "small teams shipping on Vercel")?

---

## 11. Suggested next steps

1. **Validate demand cheaply** — landing page + waitlist, drive a little traffic, measure signups before building infra.
2. **Spike the crypto** — prove the zero-knowledge encrypt/decrypt + member envelope flow works end-to-end in a CLI prototype. This is the riskiest technical assumption.
3. **Nail the first-run DX** — install → link → pull in under 2 minutes. Record it; it's your best demo.
4. **Write the public encryption doc early** — it doubles as a trust asset and forces design clarity.
5. **Pick one beachhead** (persona + ecosystem) and go deep rather than "works with everything."

---

## 12. Assets

- `keyline.html` — landing page draft (dark/technical aesthetic, animated CLI hero, zero-knowledge flow diagram, audit log mockup, pricing, FAQ). Single self-contained file; opens in any browser.

---

_This doc reflects a concept under evaluation, including the honest concerns raised during analysis. It is a starting point, not a validated business plan — treat the risks section as the part to disprove before investing heavily._
