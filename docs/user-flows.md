# Keyline: User Flows

How the app works, told as real user steps. This is the target design (milestones M1–M6). Today only the landing page and the M0 scaffold exist. These flows are what we build toward.

See also: [MVP scope](mvp-scope.md), [ICP](icp.md), [ADR-0002 zero-knowledge boundary](decisions/0002-zero-knowledge-boundary.md).

## 1. First run (solo dev)

1. Run `curl -fsSL keyline.sh/install | sh`. The CLI installs.
2. Run `keyline login`. A browser opens, you sign in, the device is authorized.
3. Your machine generates a device keypair. The private key stays on your laptop. Only the public key goes to the server.
4. You start on the free Solo plan. No card needed.

## 2. Put your first secrets in

1. In your project folder, run `keyline link` (the folder name becomes the project; add `--env dev` to pick an environment).
2. The folder is now bound to a workspace and environment.
3. Run `keyline push`. Your local `.env` is encrypted on your laptop, then uploaded.
4. The server only ever stores ciphertext. It cannot read your keys.

## 3. Daily use

1. `keyline pull` decrypts your secrets into a local `.env`.
2. `keyline run -- npm run dev` injects secrets straight into the process. No file touches disk.
3. That is the loop. No more `.env` in Slack. No more `.env` in git.

## 4. Add your team

1. Upgrade to Team. See Billing below.
2. Invite a teammate by email (`keyline members invite` or the Members page). You get a one-time join code to send them. It lives 7 days.
3. Scope them per environment. For example, read-only on `prod`.
4. Under the hood, the workspace key is re-wrapped to their device key. Nothing is re-encrypted. Access is just granted.

## 5. A teammate joins

1. They install the CLI and run `keyline join <code>` with the code you sent them.
2. You grant them access: `keyline members grant them@co.com --env dev`. That wraps the workspace key to their device.
3. They run `keyline link my-app --env dev`, then `keyline pull`.
4. They have the secrets in minutes. They learned zero new concepts.

## 6. Someone leaves or a key leaks

1. Run `keyline revoke teammate@co.com`. Their access is cut at once.
2. Run `keyline rotate OPENAI_API_KEY` to replace a single secret.
3. Every action is logged.

## 7. See who did what

1. `keyline audit --env prod` shows every read, write, and denied attempt. Who, what, when.
2. The log is tamper-evident. Entries are hash-chained, so edits are detectable.

## 8. The dashboard (web)

For people who do not live in the terminal:

1. Sign in at the web app.
2. Manage workspaces, projects, environments, and members.
3. View the audit log and billing.
4. The dashboard shows metadata only. It never shows secret values. Values stay CLI-only. That keeps the zero-knowledge promise intact.

## 9. Billing

1. Solo is free. Limit: 1 dev, 2 environments, 7-day audit history.
2. Click upgrade. Paddle checkout opens (Paddle is the merchant of record and handles VAT + invoices). A 14-day trial starts.
3. Team is $19 flat for up to 10 members. No per-seat math.
4. If a payment fails, you get a grace period and reminders, not an instant lockout.
5. If you cancel, you drop back to Solo limits. Your data is not deleted.

## 10. Lost laptop (recovery)

1. Get a new machine, run `keyline login`.
2. Any active admin device can re-grant access. It re-wraps the workspace key to your new device.
3. A sealed recovery file also works, if you set one up.
4. Honest limit: if every device is lost and there is no recovery file, the secrets are gone. That is the point of zero-knowledge.

## The one idea under it all

Your secrets are encrypted on your laptop before they leave. The server holds only locked boxes. Each member has their own key to the box. We never hold the master key. So a breach of us is not a breach of you.
