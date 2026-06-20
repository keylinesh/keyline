# @keyline/web — dashboard

React + TypeScript dashboard. **Not yet scaffolded** — this is a placeholder so the
workspace resolves. Build it out in milestone **M4**.

Scope is constrained by [ADR-0002](../../docs/decisions/0002-zero-knowledge-boundary.md):
the dashboard handles **metadata only** (workspaces, projects, environments, members,
audit log, billing). It does **not** decrypt or display secret values — those stay CLI-only.

To scaffold (when starting M4):

```sh
pnpm create vite@latest . -- --template react-ts
```
