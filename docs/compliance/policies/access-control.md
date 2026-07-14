# Access Control Policy

**Owner:** founder. **Review:** yearly. Access review: quarterly evidence day.

## Principles

Least privilege, invitation-only, revocable in one step.

## Customer-facing access (the product)

- Authentication is possession of a device private key. No passwords exist.
- Workspace membership is by invitation with one-time, expiring join codes.
- Environment access is deny-by-default; admins grant per environment.
- Revocation is immediate: tokens dropped, wrapped keys deleted, devices
  marked revoked, in one operation.
- Web sessions are metadata-only, 8 hours, approved from a trusted CLI device
  or a device-bound single-use email link.

## Internal access (running Keyline)

| System | Who | Protection |
| --- | --- | --- |
| GitLab (code, CI) | founder | 2FA, protected `main`, scoped tokens |
| Vercel (hosting, env) | founder | 2FA |
| Neon (database) | founder | 2FA, connection strings in env only |
| Paddle (billing) | founder | 2FA |
| Resend, Sentry | founder | 2FA |

Service tokens are scoped to what they do (the anchor publisher token can push
to the anchors repo, nothing else) and are rotated if exposure is suspected.

## Onboarding and offboarding

No employees yet. Before the first hire: this policy gains provisioning and
offboarding checklists, and privileged access gets a second pair of eyes.

## Quarterly review

On evidence day: list members and tokens on each system above, confirm each is
needed, screenshot into the evidence folder, revoke anything stale.
