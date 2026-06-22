#!/usr/bin/env node
/**
 * keyline CLI — entrypoint.
 *
 * The command surface below is the planned API (see keyline-context.md §7).
 * Most commands are wired in their own milestone-M3 issues. `login` is live: it
 * provisions this device's keypair and local key storage (M1 issue #12).
 */

import { openKeyStore } from "./keystore.js";
import {
  loadOrCreateDeviceIdentity,
  clearDeviceIdentity,
  registrationOf,
} from "./device.js";

const COMMANDS: Record<string, string> = {
  login: "auth this device",
  link: "bind a directory to a workspace/environment",
  push: "encrypt local .env -> workspace",
  pull: "decrypt workspace -> local .env",
  run: "inject vars into a process, no file written",
  rotate: "rotate a single secret",
  revoke: "cut a member's access immediately",
  audit: "view / export the log",
  members: "list + scope members per environment",
};

function printHelp(): void {
  console.log("keyline — share .env files securely with one command\n");
  console.log("Usage: keyline <command> [options]\n");
  console.log("Commands:");
  for (const [name, desc] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(10)} ${desc}`);
  }
  console.log("\n(Commands are not implemented yet — tracked in milestone M3.)");
}

/** `keyline login` — provision this device's keypair + local key storage. */
function cmdLogin(args: string[]): void {
  const store = openKeyStore();
  if (args.includes("--reset")) {
    clearDeviceIdentity(store);
    console.log("Local device identity cleared.");
  }

  const { identity, created } = loadOrCreateDeviceIdentity(store);
  const reg = registrationOf(identity);

  console.log(
    created
      ? "New device keypair generated."
      : "Device already provisioned on this machine.",
  );
  console.log(`  device id:   ${reg.deviceId}`);
  console.log(`  public key:  ${reg.publicKey}`);
  console.log(`  key storage: ${store.backend}`);
  console.log(
    "\nThe private key stays on this device. Server registration of the public" +
      "\nkey lands with the API in milestone M2.",
  );
}

const [command, ...rest] = process.argv.slice(2);

if (!command || command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (!(command in COMMANDS)) {
  console.error(`unknown command: ${command}\n`);
  printHelp();
  process.exit(1);
}

if (command === "login") {
  cmdLogin(rest);
  process.exit(0);
}

console.log(`'keyline ${command}' is not implemented yet (milestone M3).`);
process.exit(0);
