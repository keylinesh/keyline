/**
 * keyline CLI — command surface (commander).
 *
 * #30 wired the framework, config, and credential storage; #31–#35 filled in
 * the commands. The full surface is live: login, link, status, push, pull,
 * run, rotate, revoke, audit, members. All crypto goes through @keyline/crypto
 * (via device.ts and the command modules).
 */

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { Command } from "commander";
import { openKeyStore } from "./keystore.js";
import { loadDeviceIdentity } from "./device.js";
import { loadAccount } from "./account.js";
import { findProjectConfig, loadGlobalConfig } from "./config.js";
import { isCredentialValid, loadCredentials } from "./credentials.js";
import { runLogin } from "./commands/login.js";
import { runJoin } from "./commands/join.js";
import { runLink } from "./commands/link.js";
import { runPush } from "./commands/push.js";
import { runPull } from "./commands/pull.js";
import { runRun } from "./commands/run.js";
import { runRotate } from "./commands/rotate.js";
import { runRevoke } from "./commands/revoke.js";
import { runAudit, runAuditVerify } from "./commands/audit.js";
import { runWebApprove } from "./commands/web.js";
import { parseEnvRole, runGrant, runInvite, runMembersList } from "./commands/members.js";
import { confirm, promptHidden, promptLine, readStdin } from "./prompt.js";

// Injected by the bundlers (esbuild define); absent when running from source.
declare const __KEYLINE_VERSION__: string | undefined;

function version(): string {
  if (typeof __KEYLINE_VERSION__ === "string") return __KEYLINE_VERSION__;
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("keyline")
    .description("Share .env files securely with one command. Servers only ever hold ciphertext.")
    .version(version(), "-v, --version", "print the version")
    .enablePositionalOptions(); // lets `run` pass the child command's flags through

  program
    .command("login")
    .description("authenticate this device (creates an account on first run)")
    .option("--workspace <name>", "workspace name (first run, creates the account)")
    .option("--email <email>", "your email (first run)")
    .option("--reset", "forget the local account + session and start over")
    .action(async (opts: { workspace?: string; email?: string; reset?: boolean }) => {
      const cfg = loadGlobalConfig();
      const store = openKeyStore();

      // First run on a TTY: ask instead of erroring with flag instructions (#36).
      let { workspace, email } = opts;
      const firstRun = opts.reset || !loadAccount(store);
      if (firstRun && process.stdin.isTTY) {
        console.log("Welcome to keyline. Two questions and you're in.");
        if (!workspace) workspace = await promptLine("Workspace name (your team or app): ");
        if (!email) email = await promptLine("Your email: ");
      }

      const result = await runLogin(
        { apiBaseUrl: cfg.apiBaseUrl, store },
        { workspaceName: workspace || undefined, email: email || undefined, reset: opts.reset },
      );
      console.log(result.created ? "Account created and logged in." : "Logged in.");
      console.log(`  workspace:   ${result.workspaceId}`);
      console.log(`  device id:   ${result.deviceId}`);
      console.log(`  key storage: ${result.keyStorage}`);
      console.log("\nNext: cd into your project, then `keyline link` and `keyline push`.");
    });

  program
    .command("join")
    .description("join a workspace you were invited to, with a join code")
    .argument("<code>", "the one-time join code from your admin, e.g. ABCD-EFGH-JKMN")
    .action(async (code: string) => {
      const cfg = loadGlobalConfig();
      const result = await runJoin({ apiBaseUrl: cfg.apiBaseUrl, store: openKeyStore() }, code);
      console.log(`Joined ${result.workspaceName} as ${result.email} (${result.role}).`);
      console.log(`  device id:   ${result.deviceId}`);
      console.log(`  key storage: ${result.keyStorage}`);
      console.log(
        "\nNext: ask an admin to run `keyline members grant " +
          result.email +
          " --env <env>` so this device gets the workspace key. Then `keyline link` and `keyline pull`.",
      );
    });

  program
    .command("link")
    .description("bind this directory to a workspace/project/environment")
    .argument("[project]", "project name (defaults to this folder's name)")
    .option("-e, --env <env>", "environment name", "prod")
    .action(async (project: string | undefined, opts: { env: string }) => {
      const cfg = loadGlobalConfig();
      const result = await runLink(
        { apiBaseUrl: cfg.apiBaseUrl, store: openKeyStore() },
        { project, environment: opts.env },
      );
      console.log(`Linked this directory:`);
      console.log(`  project:     ${result.projectSlug}${project ? "" : " (from the folder name)"}`);
      console.log(`  environment: ${result.environmentName}`);
      console.log("\nNext: `keyline push` to upload your .env, encrypted.");
    });

  program
    .command("push")
    .description("encrypt the local .env and upload it (ciphertext only)")
    .option("-f, --file <path>", "env file to push (default: .env next to .keyline.json)")
    .option("--force", "overwrite the server version without the conflict check")
    .action(async (opts: { file?: string; force?: boolean }) => {
      const cfg = loadGlobalConfig();
      const result = await runPush(
        { apiBaseUrl: cfg.apiBaseUrl, store: openKeyStore() },
        { file: opts.file, force: opts.force },
      );
      if (result.bootstrappedKey) {
        console.log("Created this workspace's encryption key (stays on your devices).");
      }
      console.log(
        `Pushed ${result.secretCount} secrets to ${result.label} (version ${result.version}).`,
      );
      if (result.warning) console.log(result.warning);
    });

  program
    .command("pull")
    .description("download and decrypt secrets into the local .env")
    .option("-f, --file <path>", "file to write (default: .env next to .keyline.json)")
    .action(async (opts: { file?: string }) => {
      const cfg = loadGlobalConfig();
      const result = await runPull(
        { apiBaseUrl: cfg.apiBaseUrl, store: openKeyStore() },
        { file: opts.file },
      );
      const rel = relative(process.cwd(), result.envFile);
      const shown = rel && !rel.startsWith("..") ? rel : result.envFile;
      console.log(`Pulled ${result.secretCount} secrets into ${shown} (version ${result.version}).`);
      if (result.warning) console.log(result.warning);
    });

  program
    .command("status")
    .description("show the current context (api, device, session, binding)")
    .action(() => {
      const cfg = loadGlobalConfig();
      const store = openKeyStore();
      const device = loadDeviceIdentity(store);
      const account = loadAccount(store);
      const session = isCredentialValid(loadCredentials(store)) ? "active" : "none";
      const project = findProjectConfig();

      console.log(`api:       ${cfg.apiBaseUrl}`);
      console.log(`device:    ${device ? "provisioned" : "not provisioned — run `keyline login`"}`);
      console.log(`account:   ${account ? `${account.email} (workspace ${account.workspaceId})` : "none — run `keyline login`"}`);
      console.log(`session:   ${session}`);
      if (project) {
        const { config, path } = project;
        console.log(`linked:    ${config.projectSlug ?? config.projectId} / ${config.environmentName ?? config.environmentId}`);
        console.log(`           (${path})`);
      } else {
        console.log("linked:    this directory is not linked — run `keyline link`");
      }
    });

  program
    .command("run")
    .description("run a command with secrets injected — nothing written to disk")
    .argument("<cmd...>", "the command to run (use `keyline run -- cmd --flags`)")
    .passThroughOptions()
    .action(async (cmd: string[]) => {
      const cfg = loadGlobalConfig();
      const [command, ...args] = cmd;
      const outcome = await runRun(
        { apiBaseUrl: cfg.apiBaseUrl, store: openKeyStore() },
        { command: command!, args },
      );
      if (outcome.signal) {
        // Mirror the child's fatal signal so callers see the real outcome.
        process.kill(process.pid, outcome.signal);
      }
      process.exitCode = outcome.exitCode ?? 1;
    });

  program
    .command("rotate")
    .description("replace one secret's value (re-encrypted on this machine)")
    .argument("<name>", "the secret to rotate, e.g. OPENAI_API_KEY")
    .option("--value <value>", "the new value (omit to be prompted, or pipe it in)")
    .option("-f, --file <path>", "local env file to keep in sync")
    .action(async (name: string, opts: { value?: string; file?: string }) => {
      let value = opts.value;
      if (value === undefined) {
        value = process.stdin.isTTY
          ? await promptHidden(`New value for ${name}: `)
          : await readStdin();
      }
      if (!value) throw new Error("No value given. Pass --value, pipe one in, or type it at the prompt.");
      const cfg = loadGlobalConfig();
      const result = await runRotate(
        { apiBaseUrl: cfg.apiBaseUrl, store: openKeyStore() },
        { name, value, file: opts.file },
      );
      console.log(`Rotated ${result.name} in ${result.label} (version ${result.version}).`);
      if (result.envFileUpdated) console.log(`  local file updated: ${result.envFileUpdated}`);
      console.log("Anything running with the old value keeps it until restarted.");
    });

  program
    .command("revoke")
    .description("cut a member's access immediately")
    .argument("<email>", "the member to revoke")
    .option("-y, --yes", "skip the confirmation prompt")
    .action(async (email: string, opts: { yes?: boolean }) => {
      if (!opts.yes) {
        if (!process.stdin.isTTY) {
          throw new Error("Refusing to revoke without confirmation. Pass --yes.");
        }
        if (!(await confirm(`Immediately revoke ${email}'s access? [y/N] `))) {
          console.log("Aborted.");
          return;
        }
      }
      const cfg = loadGlobalConfig();
      const result = await runRevoke(
        { apiBaseUrl: cfg.apiBaseUrl, store: openKeyStore() },
        { email },
      );
      console.log(
        `Revoked ${result.email}: ${result.tokensRevoked} sessions ended, ` +
          `${result.devicesRevoked} devices cut off, ${result.wrappedKeysDeleted} keys deleted.`,
      );
      console.log("They may still know current values — rotate the secrets that matter.");
    });

  program
    .command("web")
    .description("approve a dashboard sign-in shown in your browser")
    .argument("<code>", "the code on the dashboard sign-in screen")
    .action(async (code: string) => {
      const cfg = loadGlobalConfig();
      await runWebApprove({ apiBaseUrl: cfg.apiBaseUrl, store: openKeyStore() }, code);
      console.log("Browser session approved. Switch back to the dashboard.");
    });

  program
    .command("audit")
    .description("who did what: view or export the tamper-evident log")
    .option("-e, --env <env>", "only events for this environment (linked project)")
    .option("-n, --limit <n>", "only the most recent N events", (v) => parseInt(v, 10))
    .option("--json", "machine-readable output")
    .option("--verify", "check the hash chain instead of listing events")
    .action(async (opts: { env?: string; limit?: number; json?: boolean; verify?: boolean }) => {
      const cfg = loadGlobalConfig();
      const deps = { apiBaseUrl: cfg.apiBaseUrl, store: openKeyStore() };
      if (opts.verify) {
        const v = await runAuditVerify(deps);
        if (opts.json) return void console.log(JSON.stringify(v));
        console.log(
          v.ok
            ? `Chain intact: ${v.count} events verified.`
            : `CHAIN BROKEN at seq ${v.brokenSeq}: ${v.reason}`,
        );
        if (!v.ok) process.exitCode = 1;
        return;
      }
      const result = await runAudit(deps, { env: opts.env, limit: opts.limit });
      if (opts.json) return void console.log(JSON.stringify(result.events, null, 2));
      if (result.events.length === 0) return void console.log("No events yet.");
      for (const e of result.events) {
        const detail = e.metadata && Object.keys(e.metadata).length > 0
          ? `  ${JSON.stringify(e.metadata)}`
          : "";
        console.log(
          `${e.createdAt}  ${e.outcome.padEnd(7)}  ${e.action.padEnd(16)}  ${e.actor}${detail}`,
        );
      }
      if (result.total > result.events.length) {
        console.log(`(${result.events.length} of ${result.total} — raise --limit to see more)`);
      }
      if (result.retentionDays) {
        console.log(`Showing the last ${result.retentionDays} days. Unlimited history on Team ($19/mo flat).`);
      }
    });

  const members = program
    .command("members")
    .description("list members and scope their access per environment");

  members
    .command("list", { isDefault: true })
    .description("list workspace members (add --env for per-environment roles)")
    .option("-e, --env <env>", "show each member's role for this environment")
    .option("--json", "machine-readable output")
    .action(async (opts: { env?: string; json?: boolean }) => {
      const cfg = loadGlobalConfig();
      const result = await runMembersList(
        { apiBaseUrl: cfg.apiBaseUrl, store: openKeyStore() },
        { env: opts.env },
      );
      if (opts.json) return void console.log(JSON.stringify(result.members, null, 2));
      for (const m of result.members) {
        const envRole =
          result.env !== undefined
            ? `  ${result.env}: ${m.envRole ?? (m.role === "member" ? "no access" : `${m.role} (implicit)`)}`
            : "";
        console.log(`${m.email.padEnd(32)}  ${m.role}${envRole}`);
      }
    });

  members
    .command("invite")
    .description("add a member to the workspace")
    .argument("<email>", "their email")
    .option("--role <role>", "workspace role: member or admin", "member")
    .action(async (email: string, opts: { role: string }) => {
      if (opts.role !== "member" && opts.role !== "admin") {
        throw new Error(`workspace role must be "member" or "admin" (got "${opts.role}")`);
      }
      const cfg = loadGlobalConfig();
      const invited = await runInvite(
        { apiBaseUrl: cfg.apiBaseUrl, store: openKeyStore() },
        { email, role: opts.role },
      );
      console.log(`Invited ${invited.email} as ${invited.role}.`);
      if (invited.joinCode) {
        console.log(`  join code: ${invited.joinCode}  (one-time, expires in 7 days; also emailed)`);
        console.log(`  they run:  keyline join ${invited.joinCode}`);
      }
      console.log("Next: `keyline members grant " + invited.email + " --env <env> --role read|write|admin`");
    });

  members
    .command("grant")
    .description("give a member a role on an environment (and the key to decrypt)")
    .argument("<email>", "the member")
    .requiredOption("-e, --env <env>", "environment name (linked project)")
    .requiredOption("-r, --role <role>", "read, write, or admin")
    .action(async (email: string, opts: { env: string; role: string }) => {
      const cfg = loadGlobalConfig();
      const result = await runGrant(
        { apiBaseUrl: cfg.apiBaseUrl, store: openKeyStore() },
        { email, env: opts.env, role: parseEnvRole(opts.role) },
      );
      console.log(`Granted ${result.email} ${result.role} on ${result.env}.`);
      if (result.keysIssued > 0) {
        console.log(`  workspace key wrapped to ${result.keysIssued} of their device(s).`);
      }
      if (result.memberHasNoDevice) {
        console.log("  note: they have no device yet — they can decrypt once one is registered.");
      }
    });

  return program;
}
