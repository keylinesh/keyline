# Data Management Policy

**Owner:** founder. **Review:** yearly.

## Classification

| Class | What | Handling |
| --- | --- | --- |
| Customer secrets | Secret values | Ciphertext only, client-side encrypted; we hold no key. Never logged, never in Sentry, never in email |
| Customer personal data | Member emails, names, device public keys, audit events | Postgres in the EU region, TLS in transit, minimum collection, DPA terms |
| Operational data | Technical logs, error events | Short-lived; Sentry events scrubbed twice before send |
| Public data | Marketing site, docs, audit anchors | Anchors carry hashes only |
| Keyline's own secrets | API tokens, DSNs, DB URLs | Local `.env` (gitignored) + Vercel env; never in git or chat |

## Retention

- Workspace data lives while the workspace lives. Deleting a workspace deletes
  its data from the primary database.
- Database backups expire on Neon's rolling window; deleted data ages out of
  restore points with it.
- Audit events are the customer's tamper-evident history and are kept for the
  life of the workspace (plan limits gate how far back the UI lists).
- Technical logs and Sentry events expire on short vendor-default windows.

## Disposal

Deletion requests beyond self-service go to support@keyline.sh and complete
within 30 days, confirmed in writing. Founder hardware is FileVault-encrypted;
disposal means a wiped or destroyed disk.

## No production data in development

Development uses memory repos and test fixtures. The staging environment (#59)
gets its own database branch, never a copy with real customer data.
