import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMigrations } from "./migrations.js";

test("loads the committed init migration with its SQL", () => {
  const migrations = loadMigrations();
  const init = migrations.find((m) => m.name === "0001_init.sql");
  assert.ok(init, "0001_init.sql should be present");
  assert.match(init.sql, /create table workspaces/);
});

test("returns migrations in apply order and ignores non-sql files", () => {
  const dir = mkdtempSync(join(tmpdir(), "keyline-mig-"));
  try {
    writeFileSync(join(dir, "0002_second.sql"), "select 2;");
    writeFileSync(join(dir, "0001_first.sql"), "select 1;");
    writeFileSync(join(dir, "0010_tenth.sql"), "select 10;");
    writeFileSync(join(dir, "README.md"), "not a migration");
    const names = loadMigrations(dir).map((m) => m.name);
    assert.deepEqual(names, ["0001_first.sql", "0002_second.sql", "0010_tenth.sql"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
