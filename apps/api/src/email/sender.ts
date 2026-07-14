/**
 * Email sending (#78) — the first email Keyline sends: invitation join codes.
 *
 * Provider: Resend, via its plain HTTP API (no SDK, matching the repo's
 * thin-client style). Dormant without RESEND_API_KEY: invites still work, the
 * admin just shares the join command by hand. Plain-text emails on purpose —
 * short, human, no tracking pixels. Never put secret values in an email; a
 * join code is a one-time, 7-day invitation credential, which is the same
 * trust level as the email inbox it's sent to.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  /** Returns the provider message id, or null if sending failed. */
  send(message: EmailMessage): Promise<string | null>;
}

export interface ResendConfig {
  apiKey: string;
  /** RFC 5322 From, e.g. `Keyline <invites@keyline.sh>`. */
  from: string;
}

export function resendConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ResendConfig | null {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return null;
  return { apiKey, from: env.EMAIL_FROM ?? "Keyline <invites@keyline.sh>" };
}

export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly config: ResendConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<string | null> {
    try {
      const res = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: this.config.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { id?: string };
      return data.id ?? null;
    } catch {
      // Email is best-effort: a provider outage must never block an invite.
      return null;
    }
  }
}

/** The invitation email (#78). Short and human per docs/voice.md. */
export function inviteEmail(input: {
  workspaceName: string;
  inviterEmail: string | null;
  joinCode: string;
}): Omit<EmailMessage, "to"> {
  const invitedBy = input.inviterEmail ? `${input.inviterEmail} invited you` : "You were invited";
  return {
    subject: `Join ${input.workspaceName} on Keyline`,
    text: `${invitedBy} to the "${input.workspaceName}" workspace on Keyline.

Keyline shares your team's .env secrets, encrypted end to end.

To join, install the CLI and run these two commands:

  npm i -g @keylinesh/cli
  keyline join ${input.joinCode}

The code works once and expires in 7 days. If it expired, ask for a new one.

New to Keyline? https://keyline.sh
`,
  };
}
