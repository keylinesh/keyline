/**
 * CLI reference — every command, what it does, and the flags worth knowing.
 * Static content by design: the CLI is the product's real surface, and this
 * page is the in-app manual for it. Grouped by when you need them.
 */

import { CopyButton } from "./CopyButton.js";

interface Cmd {
  cmd: string;
  what: string;
  flags?: Array<[string, string]>;
}

interface Group {
  title: string;
  lead: string;
  cmds: Cmd[];
}

const GROUPS: Group[] = [
  {
    title: "Get set up",
    lead: "The first five minutes. You only ever do these once per machine or project.",
    cmds: [
      {
        cmd: "keyline login",
        what: "Authenticate this device. On first run it creates your account: two questions, no card.",
        flags: [
          ["--workspace <name>", "workspace name on first run"],
          ["--email <email>", "your email on first run"],
          ["--reset", "forget this device's account and start over"],
        ],
      },
      {
        cmd: "keyline join ABCD-EFGH-JKMN",
        what: "Join a workspace you were invited to. The one-time code comes from your admin's invite email.",
      },
      {
        cmd: "keyline link",
        what: "Bind the current folder to a project and environment. Keyline remembers it in .keyline.json (ids only, safe to commit).",
        flags: [
          ["[project]", "project name; defaults to the folder's name"],
          ["-e, --env <env>", "environment name, default prod"],
        ],
      },
      {
        cmd: "keyline status",
        what: "Show where you are: API, device, session, and what this folder is linked to. The first thing to run when something looks off.",
      },
    ],
  },
  {
    title: "Daily work",
    lead: "The loop you'll actually live in.",
    cmds: [
      {
        cmd: "keyline push",
        what: "Encrypt the local .env on your machine and upload it. The server only ever sees ciphertext.",
        flags: [
          ["-f, --file <path>", "push a different env file"],
          ["--force", "overwrite the server version without the conflict check"],
        ],
      },
      {
        cmd: "keyline pull",
        what: "Download the latest version and decrypt it into your local .env. Comments and order survive.",
        flags: [["-f, --file <path>", "write to a different file"]],
      },
      {
        cmd: "keyline run -- npm start",
        what: "Run any command with the secrets injected as environment variables. Nothing is written to disk.",
      },
      {
        cmd: "keyline rotate OPENAI_API_KEY",
        what: "Replace one secret's value, re-encrypted on your machine. Prompts for the value, or pipe it in.",
        flags: [
          ["--value <value>", "pass the new value directly"],
          ["-f, --file <path>", "keep a local env file in sync too"],
        ],
      },
    ],
  },
  {
    title: "Your team",
    lead: "Invite, scope, and cut access. Grants are per environment: interns never see prod.",
    cmds: [
      {
        cmd: "keyline members",
        what: "List everyone in the workspace.",
        flags: [["-e, --env <env>", "show each member's role for that environment"]],
      },
      {
        cmd: "keyline members invite sam@acme.com",
        what: "Add a member. They get an email with a one-time join code, and you see the code too.",
        flags: [["--role <role>", "workspace role: member (default) or admin"]],
      },
      {
        cmd: "keyline members grant sam@acme.com --env prod --role read",
        what: "Give a member a role on one environment and wrap the decryption key to their devices. Roles: read, write, admin.",
      },
      {
        cmd: "keyline revoke sam@acme.com",
        what: "Cut a member's access now: sessions ended, devices cut off, keys deleted. Then rotate the secrets that matter.",
        flags: [["-y, --yes", "skip the confirmation prompt"]],
      },
    ],
  },
  {
    title: "Trust and access",
    lead: "The receipts, and the bridge to this dashboard.",
    cmds: [
      {
        cmd: "keyline audit",
        what: "Who did what: every read, write, grant, and denied attempt, from the tamper-evident log.",
        flags: [
          ["-e, --env <env>", "only one environment"],
          ["-n, --limit <n>", "only the most recent N events"],
          ["--json", "machine-readable output"],
        ],
      },
      {
        cmd: "keyline audit --verify",
        what: "Check the hash chain end to end. If anyone edited or deleted history, this says exactly where it breaks.",
      },
      {
        cmd: "keyline web KR87-AYMQ",
        what: "Approve a dashboard sign-in from this trusted device. The code is on the sign-in screen.",
      },
    ],
  },
];

export function Commands() {
  return (
    <div>
      {GROUPS.map((g) => (
        <div className="res-card" key={g.title}>
          <h3 className="card-title">{g.title}</h3>
          <p className="cmd-lead">{g.lead}</p>
          {g.cmds.map((c) => (
            <div className="cmd-entry" key={c.cmd}>
              <div className="code-box small">
                <span className="pr">$</span> {c.cmd}
                <CopyButton text={c.cmd} label={`copy ${c.cmd}`} />
              </div>
              <p className="cmd-what">{c.what}</p>
              {c.flags && (
                <dl className="cmd-flags">
                  {c.flags.map(([flag, what]) => (
                    <div key={flag}>
                      <dt className="mono">{flag}</dt>
                      <dd>{what}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ))}
        </div>
      ))}
      <p className="hint">
        Every command explains its own failures and names the fix. When in doubt: <code className="mono">keyline status</code>.
      </p>
    </div>
  );
}
