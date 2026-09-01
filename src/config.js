// Parses the command line flags and environment variables that configure the
// server.

import process from "node:process";
import path from "node:path";
import { tmpdir } from "node:os";

export const DEFAULT_ENDPOINT = "https://api.dooray.com";
export const MODE_FULL = "full";
export const MODE_READ_ONLY = "read-only";

const DEFAULT_TIMEOUT_MS = 30000;

/** Reads the arguments the server and its subcommands share. */
export function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    const take = (name) => {
      if (index + 1 >= argv.length) {
        throw new Error(`${name} requires a value`);
      }
      index += 1;
      return argv[index];
    };

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--token") {
      parsed.token = take("--token");
    } else if (arg.startsWith("--token=")) {
      parsed.token = arg.slice("--token=".length);
    } else if (arg === "--endpoint") {
      parsed.endpoint = take("--endpoint");
    } else if (arg.startsWith("--endpoint=")) {
      parsed.endpoint = arg.slice("--endpoint=".length);
    } else if (arg === "--mode") {
      parsed.mode = take("--mode");
    } else if (arg.startsWith("--mode=")) {
      parsed.mode = arg.slice("--mode=".length);
    }
  }

  return parsed;
}

/** Resolves the runtime settings, throwing when something is unusable. */
export function loadConfig(argv, env = process.env) {
  const args = parseArgs(argv);

  if (args.help) {
    return { help: true };
  }

  const token = args.token || env.DOORAY_TOKEN;
  if (!token) {
    throw new Error("token must be set. Use --token <token> or DOORAY_TOKEN.");
  }

  const endpoint = (
    args.endpoint ||
    env.DOORAY_ENDPOINT ||
    DEFAULT_ENDPOINT
  ).replace(/\/+$/, "");

  const mode = normalizeMode(args.mode || env.DOORAY_MCP_MODE || MODE_FULL);
  const requestTimeoutMs = parseTimeout(env.DOORAY_REQUEST_TIMEOUT_MS);
  const downloadDirectory = path.resolve(
    env.DOORAY_DOWNLOAD_DIR || path.join(tmpdir(), "dooray-mcp"),
  );

  return { token, endpoint, mode, requestTimeoutMs, downloadDirectory };
}

function normalizeMode(value) {
  if (value === MODE_FULL || value === MODE_READ_ONLY) {
    return value;
  }
  throw new Error(
    `DOORAY_MCP_MODE or --mode must be one of: ${MODE_FULL}, ${MODE_READ_ONLY}`,
  );
}

function parseTimeout(value) {
  if (value === undefined || value === "") {
    return DEFAULT_TIMEOUT_MS;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("DOORAY_REQUEST_TIMEOUT_MS must be a positive integer");
  }
  return parsed;
}

export function helpText() {
  return `Usage: dooray-mcp-link --token <dooray-token> [--endpoint ${DEFAULT_ENDPOINT}] [--mode ${MODE_FULL}|${MODE_READ_ONLY}]

Subcommands:
  register           Add this server to the Claude Desktop configuration.
                     Run "dooray-mcp-link register --help" for its options.

Environment:
  DOORAY_TOKEN       Dooray personal API token
  DOORAY_ENDPOINT    Dooray API endpoint, default ${DEFAULT_ENDPOINT}
  DOORAY_MCP_MODE    tool exposure mode: ${MODE_FULL} or ${MODE_READ_ONLY}, default ${MODE_FULL}
  DOORAY_REQUEST_TIMEOUT_MS  request timeout, default ${DEFAULT_TIMEOUT_MS}
  DOORAY_DOWNLOAD_DIR        attachment directory, default system temp directory
`;
}
