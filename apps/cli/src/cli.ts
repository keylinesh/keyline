/**
 * keyline CLI — command surface (commander).
 *
 * #30 wired the framework, config, and credential storage. `login`, `link`,
 * `push`, `pull`, and `status` are live; the rest are registered as stubs whose
 * implementations land in their own M3 issues. All crypto goes through
 * @keyline/crypto (via device.ts and the command modules).
 */

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { openKeyStore } from "./keystore.js";
import { loadDeviceIdentity } from "./device.js";
import { loadAccount } from "./account.js";
import { findProjectConfig, loadGlobalConfig } from "./config.js";
import { isCredentialValid, loadCredentials } from "./credentials.js";
import { runLogin } from "./commands/login.js";
import { explainLinkError, runLink } from "./commands/link.js";
import { runPush } from "./commands/push.js";
import { runPull } from "./commands/pull.js";

function version(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Placeholder action for commands implemented in a later M3 issue. */
function notYet(issue: string): () => void {
  return () => console.log(`'keyline' for this command lands in milestone M3 (${issue}).`);
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("keyline")
    .description("Share .env files securely with one command. Servers only ever hold ciphertext.")
    .version(version(), "-v, --version", "print the version");

  program
    .command("login")
    .description("authenticate this device (creates an account on first run)")
    .option("--workspace <name>", "workspace name (first run, creates the account)")
    .option("--email <email>", "your email (first run)")
    .option("--reset", "forget the local account + session and start over")
    .action(async (opts: { workspace?: string; email?: string; reset?: boolean }) => {
      const cfg = loadGlobalConfig();
      const result = await runLogin(
        { apiBaseUrl: cfg.apiBaseUrl, store: openKeyStore() },
        { workspaceName: opts.workspace, email: opts.email, reset: opts.reset },
      );
      console.log(result.created ? "Account created and logged in." : "Logged in.");
      console.log(`  workspace:   ${result.workspaceId}`);
      console.log(`  device id:   ${result.deviceId}`);
      console.log(`  key storage: ${result.keyStorage}`);
      console.log("\nNext: `keyline link <project> --env <env>` to bind this directory.");
    });

  program
    .command("link")
    .description("bind this directory to a workspace/project/environment")
    .argument("<project>", "project name/slug to link")
    .option("-e, --env <env>", "environment name", "prod")
    .action(async (project: string, opts: { env: string }) => {
      try {
        const cfg = loadGlobalConfig();
        const result = await runLink(
          { apiBaseUrl: cfg.apiBaseUrl, store: openKeyStore() },
          { project, environment: opts.env },
        );
        console.log(`Linked this directory:`);
        console.log(`  project:     ${result.projectSlug}`);
        console.log(`  environment: ${result.environmentName}`);
        console.log("\nNext: `keyline push` to upload your .env, encrypted.");
      } catch (err) {
        throw new Error(explainLinkError(err));
      }
    });

  program
    .command("push")
    .description("encrypt the local .env and upload it (ciphertext only)")
    .option("-f, --file <path>", "env file to push (default: .env next to .keyline.json)")
    .option("--force", "overwrite the server version without the conflict check")
    .action(async (opts: { file?: string; force?: boolean }) => {
      try {
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
      } catch (err) {
        throw new Error(explainLinkError(err));
      }
    });

  program
    .command("pull")
    .description("download and decrypt secrets into the local .env")
    .option("-f, --file <path>", "file to write (default: .env next to .keyline.json)")
    .action(async (opts: { file?: string }) => {
      try {
        const cfg = loadGlobalConfig();
        const result = await runPull(
          { apiBaseUrl: cfg.apiBaseUrl, store: openKeyStore() },
          { file: opts.file },
        );
        console.log(
          `Pulled ${result.secretCount} secrets into ${result.envFile} (version ${result.version}).`,
        );
        if (result.warning) console.log(result.warning);
      } catch (err) {
        throw new Error(explainLinkError(err));
      }
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

  const stubs: ReadonlyArray<[name: string, desc: string, issue: string]> = [
    ["run", "inject vars into a process, no file written", "#33"],
    ["rotate", "rotate a single secret", "#34"],
    ["revoke", "cut a member's access immediately", "#34"],
    ["audit", "view / export the log", "#35"],
    ["members", "list + scope members per environment", "#35"],
  ];
  for (const [name, desc, issue] of stubs) {
    program.command(name).description(desc).action(notYet(issue));
  }

  return program;
}
