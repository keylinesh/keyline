import { test } from "node:test";
import assert from "node:assert/strict";
import { appDatabaseUrl, migrationDatabaseUrl } from "./database-url.js";

test("DATABASE_URL wins for the app", () => {
  const env = { DATABASE_URL: "a", POSTGRES_DATABASE_URL: "b", POSTGRES_URL: "c" };
  assert.equal(appDatabaseUrl(env), "a");
});

test("falls back to POSTGRES_DATABASE_URL then POSTGRES_URL", () => {
  assert.equal(appDatabaseUrl({ POSTGRES_DATABASE_URL: "b", POSTGRES_URL: "c" }), "b");
  assert.equal(appDatabaseUrl({ POSTGRES_URL: "c" }), "c");
});

test("returns undefined when nothing is set", () => {
  assert.equal(appDatabaseUrl({}), undefined);
  assert.equal(migrationDatabaseUrl({}), undefined);
});

test("ignores empty values", () => {
  assert.equal(appDatabaseUrl({ DATABASE_URL: "", POSTGRES_URL: "c" }), "c");
});

test("migrations prefer an unpooled URL", () => {
  const env = { DATABASE_URL: "pooled", DATABASE_URL_UNPOOLED: "direct" };
  assert.equal(migrationDatabaseUrl(env), "direct");
  assert.equal(migrationDatabaseUrl({ POSTGRES_URL_NON_POOLING: "np", DATABASE_URL: "pooled" }), "np");
});

test("migrations fall back to a pooled URL when no unpooled one exists", () => {
  assert.equal(migrationDatabaseUrl({ DATABASE_URL: "pooled" }), "pooled");
});
