import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionConfig } from "./connection.js";

test("local hosts connect without SSL", () => {
  const cfg = connectionConfig("postgres://u:p@localhost:5432/keyline");
  assert.equal(cfg.ssl, false);
});

test("managed (non-local) hosts enable verified SSL", () => {
  const cfg = connectionConfig("postgres://u:p@ep-cool-1.eu.neon.tech/keyline");
  assert.deepEqual(cfg.ssl, { rejectUnauthorized: true });
});

test("sslmode=require forces SSL even on localhost", () => {
  const cfg = connectionConfig("postgres://u:p@localhost:5432/keyline?sslmode=require");
  assert.deepEqual(cfg.ssl, { rejectUnauthorized: true });
});

test("sslmode=disable turns SSL off even on a remote host", () => {
  const cfg = connectionConfig("postgres://u:p@db.example.com/keyline?sslmode=disable");
  assert.equal(cfg.ssl, false);
});

test("passes the connection string through", () => {
  const dsn = "postgres://u:p@localhost/keyline";
  assert.equal(connectionConfig(dsn).connectionString, dsn);
});
