# Information Security Policy

The master policy. Everything else hangs off this.

**Owner:** founder. **Review:** yearly, or when practice changes. **Approval:** merge to `main`.

## Commitments

1. Customer secret values are never readable by Keyline. This is enforced by
   design (client-side encryption), not by promise. See
   [encryption-design.md](../../encryption-design.md).
2. We collect the minimum personal data needed to run the service, per the
   [privacy policy](https://keyline.sh/privacy) and [DPA](https://keyline.sh/dpa).
3. Security claims we publish are verifiable or clearly marked as goals.

## Roles

One founder holds all roles: system owner, security officer, incident commander.
Separation of duties is impossible at this size. Compensating controls: protected
branches, CI gates, immutable audit trails (git history plus the product's
anchored audit log), and SOC 2 certified vendors underneath everything.

## Ground rules

- 2FA on every account that offers it (GitLab, Vercel, Neon, Paddle, Resend,
  Sentry, registrar, email).
- Unique passwords from a password manager. No shared accounts to share.
- Founder hardware: full-disk encryption, OS auto-updates, screen lock.
- Secrets for Keyline itself live in the local `.env` (gitignored) and Vercel
  env vars. Never in git, chat logs, or screenshots.
- Production data is never copied to development machines. Test against
  memory repos or the staging database (#59).

## Policy violations

There is no one to discipline but the founder. A violation is treated as an
incident: logged in [incident-response.md](incident-response.md), root cause
fixed, policy updated if it was wrong.
