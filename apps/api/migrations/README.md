# Database migrations

Plain SQL migrations applied in filename order. No ORM — the schema stays
portable across Postgres hosts and readable for the external security review.

## Running

```bash
export DATABASE_URL=postgres://user:pass@host:5432/keyline
pnpm --filter @keyline/api db:migrate
```

The runner ([`src/db/migrate.ts`](../src/db/migrate.ts)) creates a
`schema_migrations` table, then applies each pending file in its own
transaction. It is idempotent — re-running applies only new files.

## Adding a migration

Create the next numbered file: `0002_<short_name>.sql`. Use a zero-padded
prefix so lexicographic order matches apply order. Migrations are append-only;
never edit one that has shipped — add a new one.

## Data model (0001_init)

| Table | Holds | Crypto type (M1) |
|---|---|---|
| `workspaces` | tenant + non-secret scrypt salt | `kdf.ts` salt |
| `members` | people in a workspace (identity only) | — |
| `devices` | per-device **public** key (X25519) | `keypair.ts` publicKey |
| `projects` / `environments` | structure within a workspace | — |
| `wrapped_keys` | workspace key sealed to each device | `envelope.ts` WrappedKey |
| `secret_bundles` | versioned encrypted `.env` per environment | `bundle.ts` SealedBundle |

**Zero-knowledge invariant:** every column holds ciphertext, a wrapped key, a
public key, a non-secret salt, or plaintext metadata — never a workspace secret,
workspace key, device private key, or plaintext secret. See
[`docs/encryption-design.md`](../../../docs/encryption-design.md).

## Open design question (flag for review #18)

The current M1 design uses **one workspace key per workspace**, wrapped to every
member device. Per-environment access (issue #23) is therefore enforced by
server-side RBAC, not by cryptography: a member holding the workspace key could
decrypt any environment's ciphertext if they obtained it. True per-environment
crypto isolation would need per-environment keys. This is intentionally deferred
and should be raised with the external crypto reviewer before launch.

## Tooling that lands later

- Applying/rolling back against a live database needs Postgres provisioned
  (issue #27). Until then, `migrations.test.ts` covers the loader; the runner is
  exercised once staging exists.
