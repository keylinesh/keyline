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
  /** Optional HTML alternative; text remains the fallback. */
  html?: string;
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
          ...(message.html ? { html: message.html } : {}),
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * The invitation email (#78). Short and human per docs/voice.md. HTML is
 * email-client-safe: single column, inline styles, no external images.
 */
export function inviteEmail(input: {
  workspaceName: string;
  inviterEmail: string | null;
  joinCode: string;
}): Omit<EmailMessage, "to"> {
  const invitedBy = input.inviterEmail ? `${input.inviterEmail} invited you` : "You were invited";
  const ws = escapeHtml(input.workspaceName);
  const inviter = input.inviterEmail ? escapeHtml(input.inviterEmail) : null;
  const code = escapeHtml(input.joinCode);

  const text = `${invitedBy} to the "${input.workspaceName}" workspace on Keyline.

Keyline shares your team's .env secrets, encrypted end to end.

To join, install the CLI and run these two commands:

  npm i -g @keylinesh/cli
  keyline join ${input.joinCode}

The code works once and expires in 7 days. If it expired, ask for a new one.

New to Keyline? https://keyline.sh
`;

  const mono = "'SF Mono','JetBrains Mono',Menlo,Consolas,monospace";
  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background-color:#f4f5f7;">
  <div style="display:none;max-height:0;overflow:hidden;">Join ${ws} with one command. The code expires in 7 days.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <tr><td style="padding:0 4px 16px;font-family:${sans};font-size:16px;color:#111418;">
          <span style="font-family:${mono};font-weight:700;color:#0d9488;">k_</span>&nbsp;<span style="font-weight:700;letter-spacing:-0.01em;">Keyline</span>
        </td></tr>
        <tr><td style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:36px 36px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-family:${sans};font-size:22px;line-height:1.3;font-weight:700;color:#111418;padding-bottom:10px;">
              ${inviter ? `${inviter} invited you to <span style="color:#0d9488;">${ws}</span>` : `You're invited to <span style="color:#0d9488;">${ws}</span>`}
            </td></tr>
            <tr><td style="font-family:${sans};font-size:15px;line-height:1.6;color:#4b5563;padding-bottom:22px;">
              Keyline shares your team's <span style="font-family:${mono};font-size:13.5px;">.env</span> secrets, encrypted end to end. To join, install the CLI and run:
            </td></tr>
            <tr><td style="background-color:#0b0d10;border-radius:10px;padding:18px 20px;font-family:${mono};font-size:13.5px;line-height:1.9;color:#e9ebee;">
              <span style="color:#5eead4;">$</span> npm i -g @keylinesh/cli<br>
              <span style="color:#5eead4;">$</span> keyline join <span style="color:#fbbf77;font-weight:700;">${code}</span>
            </td></tr>
            <tr><td style="font-family:${sans};font-size:13px;line-height:1.6;color:#8a919c;padding-top:16px;">
              The code works once and expires in 7 days. If it expired, ask for a new one.
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 4px 0;font-family:${sans};font-size:12.5px;line-height:1.6;color:#9aa1ab;">
          New to Keyline? It hosts your secrets without being able to read them.
          <a href="https://keyline.sh" style="color:#0d9488;text-decoration:none;">keyline.sh</a>
          <br>
          <a href="https://keyline.sh/terms" style="color:#9aa1ab;">Terms</a> &nbsp;·&nbsp;
          <a href="https://keyline.sh/privacy" style="color:#9aa1ab;">Privacy</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return {
    subject: `You're invited to ${input.workspaceName}`,
    text,
    html,
  };
}
