/**
 * Tiny interactive prompts for the CLI. Secrets are prompted with echo muted;
 * non-TTY callers pipe values in instead (`openssl rand -hex 32 | keyline
 * rotate KEY`).
 */

import { createInterface } from "node:readline/promises";

/** Read all of stdin (pipe mode), dropping one trailing newline. */
export async function readStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.replace(/\r?\n$/, "");
}

/** Ask for a secret on a TTY without echoing the keystrokes. */
export async function promptHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  process.stdout.write(question);
  // readline echoes typed characters via _writeToOutput; mute it.
  (rl as unknown as { _writeToOutput: () => void })._writeToOutput = () => {};
  try {
    const answer = await rl.question("");
    process.stdout.write("\n");
    return answer;
  } finally {
    rl.close();
  }
}

/** Ask a plain (echoed) question, returning the trimmed answer. */
export async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** y/N confirmation. Anything but y/yes is a no. */
export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
