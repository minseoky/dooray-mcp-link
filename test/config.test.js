import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { loadConfig, MODE_FULL, MODE_READ_ONLY, DEFAULT_ENDPOINT } from "../src/config.js";

test("flags beat the environment and a trailing slash is trimmed", () => {
  const config = loadConfig(
    ["--token", "flag-token", "--endpoint=https://flag.example.com/"],
    { DOORAY_TOKEN: "env-token", DOORAY_ENDPOINT: "https://env.example.com" },
  );

  assert.equal(config.token, "flag-token");
  assert.equal(config.endpoint, "https://flag.example.com");
});

test("the defaults are applied", () => {
  const config = loadConfig([], { DOORAY_TOKEN: "env-token" });

  assert.equal(config.endpoint, DEFAULT_ENDPOINT);
  assert.equal(config.mode, MODE_FULL);
  assert.equal(config.requestTimeoutMs, 30000);
  assert.ok(path.isAbsolute(config.downloadDirectory));
});

test("a missing token is refused", () => {
  assert.throws(() => loadConfig([], {}), /token must be set/);
});

test("the mode is validated from either source", () => {
  assert.equal(
    loadConfig(["--mode", MODE_READ_ONLY], { DOORAY_TOKEN: "t" }).mode,
    MODE_READ_ONLY,
  );
  assert.equal(
    loadConfig([], { DOORAY_TOKEN: "t", DOORAY_MCP_MODE: MODE_READ_ONLY }).mode,
    MODE_READ_ONLY,
  );
  assert.throws(
    () => loadConfig(["--mode", "write-only"], { DOORAY_TOKEN: "t" }),
    /must be one of/,
  );
});

test("the timeout must be a positive integer", () => {
  assert.equal(
    loadConfig([], { DOORAY_TOKEN: "t", DOORAY_REQUEST_TIMEOUT_MS: "1500" })
      .requestTimeoutMs,
    1500,
  );
  for (const invalid of ["0", "-1", "abc", "1.5"]) {
    assert.throws(
      () =>
        loadConfig([], { DOORAY_TOKEN: "t", DOORAY_REQUEST_TIMEOUT_MS: invalid }),
      /positive integer/,
      invalid,
    );
  }
});

test("--help short-circuits before the token check", () => {
  assert.equal(loadConfig(["--help"], {}).help, true);
});

test("a flag without a value is refused", () => {
  assert.throws(() => loadConfig(["--token"], {}), /requires a value/);
});

test("the download directory can be overridden", () => {
  const config = loadConfig([], {
    DOORAY_TOKEN: "t",
    DOORAY_DOWNLOAD_DIR: "/tmp/custom-dooray",
  });
  assert.equal(config.downloadDirectory, path.resolve("/tmp/custom-dooray"));
});
