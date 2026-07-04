import { test } from "node:test";
import assert from "node:assert/strict";
import { countSecrets, parseEnv } from "./env-file.js";

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
