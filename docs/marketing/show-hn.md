# Show HN draft (final polish)

**Title (80 chars max):**

Show HN: Keyline, share .env files encrypted before they leave your laptop

**First comment (post immediately from the founder account):**

Hi HN. I built Keyline after one too many production keys landed in Slack
DMs.

It's a secrets manager deliberately narrowed to the small-team case: you
push a .env with one command, teammates pull it decrypted on their
machines, and revoking a person is one command that actually works.

Three things I think are worth your skepticism:

1. Zero-knowledge for real: AES-256-GCM client-side, X25519 device keys,
   the server stores ciphertext it cannot decrypt. The design doc is
   public and I want it torn apart:
   https://github.com/keylinesh/keyline/blob/main/docs/encryption-design.md

2. The audit log is hash-chained AND anchored daily to a public repo, so
   if I ever rewrote history you could prove it:
   https://gitlab.com/resim.boyadzhiev/keyline-anchors

3. Honest limits: no SSO, CLI-first, dashboard is metadata-only, and I'm
   a one-person company in Bulgaria. SOC 2 is a readiness program, not a
   certificate. It's all stated on keyline.sh/security.

Stack: TypeScript monorepo, Hono on Vercel, Neon Postgres, Paddle as
merchant of record. Solo is free, Team is $19 flat.

I'll be here all day. Rough edges and design criticism especially welcome.

**Rules for the day:**
- Answer everything for the first 6 hours, fastest on critical comments.
- Never argue. Thank, log as beta-feedback, state what will change.
- Post between 8:00 and 10:00 US Eastern on a weekday, never Friday.
