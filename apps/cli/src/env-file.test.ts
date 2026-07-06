import { test } from "node:test";
import assert from "node:assert/strict";
import { countSecrets, formatEnvValue, parseEnv, replaceEnvValue } from "./env-file.js";

test("parseEnv handles plain, export-prefixed, and =-containing values", () => {
  const vars = parseEnv(
    "API_KEY=sk_live_x\nexport DB_URL=postgres://u:p@host/db?ssl=true\nEMPTY=\n",
  );
  assert.deepEqual(vars, {
    API_KEY: "sk_live_x",
    DB_URL: "postgres://u:p@host/db?ssl=true",
    EMPTY: "",
  });
});

test("parseEnv skips comments and blank lines", () => {
  const vars = parseEnv("# header\n\nKEY=value\n  # indented comment\n");
  assert.deepEqual(vars, { KEY: "value" });
});

test("parseEnv handles quoting", () => {
  const vars = parseEnv(
    [
      `DOUBLE="hello world"`,
      `SINGLE='single # not-a-comment'`,
      `ESCAPES="line1\\nline2\\tend"`,
      `QUOTE_IN="say \\"hi\\""`,
      `UNQUOTED= spaced value `,
      `INLINE=value # trailing comment`,
      `HASH_IN_VALUE=abc#def`,
    ].join("\n"),
  );
  assert.equal(vars.DOUBLE, "hello world");
  assert.equal(vars.SINGLE, "single # not-a-comment");
  assert.equal(vars.ESCAPES, "line1\nline2\tend");
  assert.equal(vars.QUOTE_IN, 'say "hi"');
  assert.equal(vars.UNQUOTED, "spaced value");
  assert.equal(vars.INLINE, "value");
  assert.equal(vars.HASH_IN_VALUE, "abc#def", "# without preceding space is part of the value");
});

test("parseEnv: last assignment wins; invalid keys are ignored", () => {
  const vars = parseEnv("A=1\nA=2\n9BAD=x\n-ALSO-BAD=y\n");
  assert.deepEqual(vars, { A: "2" });
});

test("parseEnv handles CRLF files", () => {
  assert.deepEqual(parseEnv("A=1\r\nB=2\r\n"), { A: "1", B: "2" });
});

test("countSecrets counts distinct keys", () => {
  assert.equal(countSecrets("A=1\nB=2\nB=3\n# C=4\n"), 2);
});

test("replaceEnvValue swaps one value and leaves every other byte alone", () => {
  const content = "# payment keys\nSTRIPE_KEY=sk_old # inline note\nOTHER=keep\n\nexport SPACED = also-old\n";
  const rotated = replaceEnvValue(content, "STRIPE_KEY", "sk_new")!;
  assert.equal(rotated, "# payment keys\nSTRIPE_KEY=sk_new\nOTHER=keep\n\nexport SPACED = also-old\n");
  // export-prefixed and space-padded assignments are found too
  assert.match(replaceEnvValue(content, "SPACED", "x")!, /export SPACED =x\n/);
});

test("replaceEnvValue quotes values that need it and round-trips through parseEnv", () => {
  const rotated = replaceEnvValue("KEY=old\n", "KEY", 'multi word "quoted" #hash')!;
  assert.deepEqual(parseEnv(rotated), { KEY: 'multi word "quoted" #hash' });
});

test("replaceEnvValue replaces every assignment of a duplicated key", () => {
  const rotated = replaceEnvValue("A=1\nA=2\n", "A", "3")!;
  assert.deepEqual(rotated, "A=3\nA=3\n");
});

test("replaceEnvValue: missing key -> null, similar names untouched", () => {
  assert.equal(replaceEnvValue("KEY_2=x\n", "KEY", "v"), null);
  assert.throws(() => replaceEnvValue("A=1", "BAD KEY", "v"), /invalid secret name/);
});

test("formatEnvValue only quotes when needed", () => {
  assert.equal(formatEnvValue("plain-value_123"), "plain-value_123");
  assert.equal(formatEnvValue("has space"), '"has space"');
  assert.equal(formatEnvValue("line1\nline2"), '"line1\\nline2"');
  assert.equal(formatEnvValue(""), '""');
});
