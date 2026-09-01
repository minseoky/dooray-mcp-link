#!/usr/bin/env node
// Dooray Model Context Protocol server, spoken over stdio.

import process from "node:process";

import { loadConfig, helpText, MODE_READ_ONLY } from "./config.js";
import { DoorayClient } from "./dooray.js";
import { McpServer } from "./mcp.js";
import { buildRegistry } from "./tools.js";
import { runRegister } from "./register.js";

const SERVER_NAME = "dooray";
const SERVER_VERSION = "0.1.0";

async function main() {
  const argv = process.argv.slice(2);

  // `register` is a setup subcommand; every other invocation speaks MCP over
  // stdio, so it is handled before the server flags are parsed.
  if (argv[0] === "register") {
    process.exitCode = runRegister(argv.slice(1), process.stdout, process.stderr);
    return;
  }

  let config;
  try {
    config = loadConfig(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (config.help) {
    process.stdout.write(helpText());
    return;
  }

  const client = new DoorayClient(config);
  const { tools, handlers } = buildRegistry(
    client,
    config.mode === MODE_READ_ONLY,
  );

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    tools,
    handlers,
    output: process.stdout,
  });

  await server.serve(process.stdin);
}

await main();
