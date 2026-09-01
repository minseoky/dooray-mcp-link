import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  configCandidates,
  mergeConfig,
  resolveConfigPath,
  runRegister,
} from "../src/register.js";

const ENTRY = { command: "npx", env: { DOORAY_TOKEN: "tok" } };

function tempConfig(name = "claude_desktop_config.json") {
  return path.join(mkdtempSync(path.join(tmpdir(), "dooray-cfg-")), name);
}

/** Captures what runRegister writes, so exit codes and output can be checked. */
function capture(argv, env = {}) {
  const out = [];
  const err = [];
  const code = runRegister(
    argv,
    { write: (chunk) => out.push(chunk) },
    { write: (chunk) => err.push(chunk) },
    env,
  );
  return { code, stdout: out.join(""), stderr: err.join("") };
}

function configOf(stdout) {
  return JSON.parse(stdout.slice(stdout.indexOf("{"))).mcpServers;
}

test("a missing configuration is created owner-only", () => {
  const configPath = path.join(tempConfig(), "..", "nested", "config.json");
  const result = mergeConfig({ name: "dooray", entry: ENTRY, configPath });

  assert.equal(result.created, true);
  assert.equal(result.replaced, false);
  assert.equal(result.backupPath, "");

  const written = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(written.mcpServers.dooray.env.DOORAY_TOKEN, "tok");

  if (process.platform !== "win32") {
    assert.equal(statSync(configPath).mode & 0o777, 0o600);
  }
});

test("other servers and top-level settings survive the merge", () => {
  const configPath = tempConfig();
  const original = JSON.stringify({
    globalShortcut: "Alt+Space",
    mcpServers: { filesystem: { command: "npx", args: ["-y", "x"] } },
  });
  writeFileSync(configPath, original);

  const result = mergeConfig({ name: "dooray", entry: ENTRY, configPath });
  assert.equal(result.backupPath, `${configPath}.bak`);
  assert.equal(readFileSync(result.backupPath, "utf8"), original);

  const written = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(written.globalShortcut, "Alt+Space");
  assert.deepEqual(Object.keys(written.mcpServers).sort(), [
    "dooray",
    "filesystem",
  ]);
  assert.deepEqual(written.mcpServers.filesystem.args, ["-y", "x"]);
});

test("a duplicate name is refused without --force and the file is untouched", () => {
  const configPath = tempConfig();
  mergeConfig({ name: "dooray", entry: { command: "first" }, configPath });

  assert.throws(
    () => mergeConfig({ name: "dooray", entry: { command: "second" }, configPath }),
    /server name already exists/,
  );
  assert.equal(
    JSON.parse(readFileSync(configPath, "utf8")).mcpServers.dooray.command,
    "first",
  );
});

test("--force replaces the existing entry", () => {
  const configPath = tempConfig();
  mergeConfig({ name: "dooray", entry: { command: "first" }, configPath });

  const result = mergeConfig({
    name: "dooray",
    entry: { command: "second" },
    configPath,
    force: true,
  });

  assert.equal(result.replaced, true);
  assert.equal(
    JSON.parse(readFileSync(configPath, "utf8")).mcpServers.dooray.command,
    "second",
  );
});

test("malformed and empty configurations are handled distinctly", () => {
  const malformed = tempConfig();
  writeFileSync(malformed, "not json");
  assert.throws(
    () => mergeConfig({ name: "dooray", entry: ENTRY, configPath: malformed }),
    /is not valid JSON/,
  );

  const empty = tempConfig();
  writeFileSync(empty, "");
  mergeConfig({ name: "dooray", entry: ENTRY, configPath: empty });
  assert.ok(JSON.parse(readFileSync(empty, "utf8")).mcpServers.dooray);
});

test("Windows candidates include the packaged-install location", () => {
  const candidates = configCandidates("win32", {
    APPDATA: "C:\\Users\\me\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
  });

  assert.ok(candidates.length >= 2);
  assert.ok(candidates.every((c) => c.endsWith("claude_desktop_config.json")));
  assert.ok(candidates[0].includes("Roaming"));
  assert.ok(candidates.some((c) => c.includes("Local")));
});

test("the resolved path is always one of the candidates", () => {
  assert.ok(configCandidates().includes(resolveConfigPath()));
});

test("register records the Windows-safe npx invocation", () => {
  // Windows npx reads a bare name@version as the command to run, so the spec
  // goes through --package and the bin is named after --.
  const { code, stdout } = capture(["--print", "--token", "tok"]);
  assert.equal(code, 0);

  const server = configOf(stdout).dooray;
  assert.equal(server.command, "npx");
  assert.equal(server.args[0], "-y");
  assert.match(server.args[1], /^--package=dooray-mcp-link@/);
  assert.equal(server.args[2], "--");
  assert.equal(server.args[3], "dooray-mcp-link");
  assert.equal(server.env.DOORAY_TOKEN, "tok");
});

test("--mode is appended after the package arguments", () => {
  const { stdout } = capture([
    "--print",
    "--token",
    "tok",
    "--mode",
    "read-only",
  ]);
  const args = configOf(stdout).dooray.args;
  assert.deepEqual(args.slice(-2), ["--mode", "read-only"]);
});

test("--command replaces only the executable", () => {
  const { stdout } = capture([
    "--print",
    "--token",
    "tok",
    "--command",
    "/usr/local/bin/dooray-mcp-link",
  ]);
  const server = configOf(stdout).dooray;
  assert.equal(server.command, "/usr/local/bin/dooray-mcp-link");
  assert.equal(server.args, undefined);
});

test("--print writes nothing to disk", () => {
  const configPath = tempConfig();
  const { code } = capture(["--print", "--token", "tok", "--config", configPath]);
  assert.equal(code, 0);
  assert.equal(existsSync(configPath), false);
});

test("the token falls back to the environment", () => {
  const { code, stdout } = capture(["--print"], { DOORAY_TOKEN: "env-token" });
  assert.equal(code, 0);
  assert.equal(configOf(stdout).dooray.env.DOORAY_TOKEN, "env-token");
});

test("a missing token is refused", () => {
  const { code, stderr } = capture(["--print"], {});
  assert.equal(code, 1);
  assert.match(stderr, /token must be set/);
});

test("bad options are refused", () => {
  for (const argv of [
    ["--mode", "write-only", "--token", "tok"],
    ["--client", "codex", "--token", "tok"],
    ["--name", "", "--token", "tok"],
    ["--token"],
    ["--nope"],
  ]) {
    assert.equal(capture(argv).code, 1, argv.join(" "));
  }
});

test("registering reports the file and asks for a restart", () => {
  const configPath = tempConfig();
  const { code, stdout } = capture([
    "--token",
    "tok",
    "--config",
    configPath,
  ]);

  assert.equal(code, 0);
  assert.match(stdout, /registered MCP server "dooray"/);
  assert.match(stdout, /restart Claude Desktop/);
  assert.ok(existsSync(configPath));
});

test("--help prints usage", () => {
  const { code, stdout } = capture(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: dooray-mcp-link register/);
});
