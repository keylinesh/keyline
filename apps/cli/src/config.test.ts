import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_API_BASE_URL,
  loadGlobalConfig,
  saveGlobalConfig,
  findProjectConfig,
  saveProjectConfig,
} from "./config.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "keyline-cfg-"));
}

test("global config defaults to the production API when absent", () => {
  const dir = tmp();
  try {
    delete process.env.KEYLINE_API_URL;
    assert.equal(loadGlobalConfig(join(dir, "config.json")).apiBaseUrl, DEFAULT_API_BASE_URL);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("global config round-trips", () => {
  const dir = tmp();
  const path = join(dir, "config.json");
  try {
    delete process.env.KEYLINE_API_URL;
    saveGlobalConfig({ apiBaseUrl: "https://api.example.com" }, path);
    assert.equal(loadGlobalConfig(path).apiBaseUrl, "https://api.example.com");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("KEYLINE_API_URL overrides the file", () => {
  const dir = tmp();
  const path = join(dir, "config.json");
  try {
    saveGlobalConfig({ apiBaseUrl: "https://from-file" }, path);
    process.env.KEYLINE_API_URL = "https://from-env";
    assert.equal(loadGlobalConfig(path).apiBaseUrl, "https://from-env");
  } finally {
    delete process.env.KEYLINE_API_URL;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findProjectConfig walks up to the binding file", () => {
  const root = tmp();
  try {
    saveProjectConfig({ workspaceId: "w", projectId: "p", environmentId: "e" }, root);
    const nested = join(root, "a", "b");
    mkdirSync(nested, { recursive: true });
    const found = findProjectConfig(nested);
    assert.ok(found);
    assert.equal(found.config.workspaceId, "w");
    assert.equal(found.config.environmentId, "e");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findProjectConfig returns null when unlinked", () => {
  const dir = tmp();
  try {
    assert.equal(findProjectConfig(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
