#!/usr/bin/env node
/**
 * keyline CLI — entrypoint stub.
 *
 * The command surface below is the planned API (see keyline-context.md §7).
 * Each command is wired in its own milestone-M3 issue. For now this prints
 * the help so the binary is runnable end-to-end from day one.
 */

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

const [command] = process.argv.slice(2);

if (!command || command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (!(command in COMMANDS)) {
  console.error(`unknown command: ${command}\n`);
  printHelp();
  process.exit(1);
}

console.log(`'keyline ${command}' is not implemented yet (milestone M3).`);
process.exit(0);
