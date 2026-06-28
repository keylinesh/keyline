/**
 * keyline CLI — command surface (commander).
 *
 * #30 wires the framework, config, and credential storage. `login` (device
 * provisioning) and `status` are live; the rest are registered as stubs whose
 * implementations land in their own M3 issues. All crypto goes through
 * @keyline/crypto (via device.ts).
 */

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { openKeyStore } from "./keystore.js";
import {
  clearDeviceIdentity,
  loadDeviceIdentity,
  loadOrCreateDeviceIdentity,
  registrationOf,
} from "./device.js";
import { findProjectConfig, loadGlobalConfig } from "./config.js";
import { isCredentialValid, loadCredentials } from "./credentials.js";

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
    .description("authenticate this device")
    .option("--reset", "clear the local device identity first")
    .action((opts: { reset?: boolean }) => {
      const store = openKeyStore();
      if (opts.reset) {
        clearDeviceIdentity(store);
        console.log("Local device identity cleared.");
      }
      const { identity, created } = loadOrCreateDeviceIdentity(store);
      const reg = registrationOf(identity);
      console.log(created ? "New device keypair generated." : "Device already provisioned.");
      console.log(`  device id:   ${reg.deviceId}`);
      console.log(`  public key:  ${reg.publicKey}`);
      console.log(`  key storage: ${store.backend}`);
      console.log("\nServer challenge + scoped token land in #31.");
    });

  program
    .command("status")
    .description("show the current context (api, device, session, binding)")
    .action(() => {
      const cfg = loadGlobalConfig();
      const store = openKeyStore();
      const device = loadDeviceIdentity(store);
      const session = isCredentialValid(loadCredentials(store)) ? "active" : "none";
      const project = findProjectConfig();

      console.log(`api:     ${cfg.apiBaseUrl}`);
      console.log(`device:  ${device ? `provisioned (${device.deviceId})` : "not provisioned — run `keyline login`"}`);
      console.log(`session: ${session}`);
      if (project) {
        const { config, path } = project;
        console.log(`linked:  ${config.projectSlug ?? config.projectId} / ${config.environmentName ?? config.environmentId}`);
        console.log(`         (${path})`);
      } else {
        console.log("linked:  this directory is not linked — run `keyline link`");
      }
    });

  const stubs: ReadonlyArray<[name: string, desc: string, issue: string]> = [
    ["link", "bind a directory to a workspace/environment", "#31"],
    ["push", "encrypt local .env -> workspace", "#32"],
    ["pull", "decrypt workspace -> local .env", "#32"],
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
