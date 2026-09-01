// The `register` subcommand: merges this server into an MCP client's
// configuration file.

import process from "node:process";
import path from "node:path";
import os from "node:os";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  mkdirSync,
  renameSync,
  readdirSync,
  copyFileSync,
  rmSync,
} from "node:fs";

const CONFIG_FILE_NAME = "claude_desktop_config.json";
const DEFAULT_SERVER_NAME = "dooray";
const PACKAGE_NAME = "dooray-mcp-link";

/**
 * Lists the locations Claude Desktop is known to keep its configuration, most
 * specific first.
 *
 * The directory is not the same on every Windows machine. A packaged (MSIX or
 * Store) install has its AppData writes redirected into a per-package
 * LocalCache, so the file can sit under LOCALAPPDATA\Packages\<package>\
 * instead of APPDATA. Rather than commit to one of those, the caller searches
 * for a file that already exists.
 */
export function configCandidates(platform = process.platform, env = process.env) {
  const home = os.homedir();

  if (platform === "darwin") {
    return [
      path.join(home, "Library", "Application Support", "Claude", CONFIG_FILE_NAME),
    ];
  }

  if (platform === "win32") {
    const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
    const localAppData = env.LOCALAPPDATA || path.join(home, "AppData", "Local");

    const candidates = [path.join(appData, "Claude", CONFIG_FILE_NAME)];

    // The package family name varies, so every package directory is examined.
    const packages = path.join(localAppData, "Packages");
    try {
      for (const entry of readdirSync(packages, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          candidates.push(
            path.join(
              packages,
              entry.name,
              "LocalCache",
              "Roaming",
              "Claude",
              CONFIG_FILE_NAME,
            ),
          );
        }
      }
    } catch {
      // No Packages directory: nothing to add.
    }

    candidates.push(path.join(localAppData, "Claude", CONFIG_FILE_NAME));
    return candidates;
  }

  const configHome = env.XDG_CONFIG_HOME || path.join(home, ".config");
  return [path.join(configHome, "Claude", CONFIG_FILE_NAME)];
}

/**
 * Returns the configuration file to merge into: the first candidate that
 * already exists, or the default location to create.
 */
export function resolveConfigPath(platform, env) {
  const candidates = configCandidates(platform, env);
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Not this one.
    }
  }
  return candidates[0];
}

/**
 * Merges one server entry into the configuration, keeping every other server
 * and top-level setting, and backing up the previous file.
 */
export function mergeConfig({ name, entry, configPath, force }) {
  const existed = existsSync(configPath);

  let config = {};
  if (existed) {
    const raw = readFileSync(configPath, "utf8");
    if (raw.trim()) {
      try {
        config = JSON.parse(raw);
      } catch (error) {
        throw new Error(`${configPath} is not valid JSON: ${error.message}`);
      }
      if (typeof config !== "object" || config === null || Array.isArray(config)) {
        throw new Error(`${configPath} is not a JSON object`);
      }
    }
  }

  const servers = config.mcpServers ?? {};
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) {
    throw new Error("mcpServers is not a JSON object");
  }

  const replaced = Object.hasOwn(servers, name);
  if (replaced && !force) {
    throw new Error(
      `server name already exists: "${name}" in ${configPath}; pass --force to replace it`,
    );
  }

  config.mcpServers = { ...servers, [name]: entry };

  let backupPath = "";
  if (existed) {
    backupPath = `${configPath}.bak`;
    copyFileSync(configPath, backupPath);
  } else {
    mkdirSync(path.dirname(configPath), { recursive: true });
  }

  writeAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`, existed);

  return { configPath, backupPath, replaced, created: !existed };
}

/**
 * Writes through a temporary file in the same directory so a failure never
 * leaves a truncated configuration behind. A new file holding an API token is
 * created owner-only.
 */
function writeAtomic(configPath, content, existed) {
  const directory = path.dirname(configPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(configPath)}.${process.pid}.tmp`,
  );

  try {
    writeFileSync(temporaryPath, content, existed ? {} : { mode: 0o600 });
    renameSync(temporaryPath, configPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

/** Runs the subcommand. argv excludes the subcommand name itself. */
export function runRegister(argv, stdout, stderr, env = process.env) {
  let options;
  try {
    options = parseRegisterArgs(argv);
  } catch (error) {
    stderr.write(`${error.message}\n${registerHelpText()}`);
    return 1;
  }

  if (options.help) {
    stdout.write(registerHelpText());
    return 0;
  }

  if (options.client !== "claude-desktop") {
    stderr.write(
      `unsupported --client "${options.client}"; only claude-desktop is supported\n`,
    );
    return 1;
  }

  const token = options.token || env.DOORAY_TOKEN;
  if (!token) {
    stderr.write("token must be set. Use --token <token> or DOORAY_TOKEN.\n");
    return 1;
  }

  const entry = buildEntry(options, token, env);

  if (options.print) {
    stdout.write(
      `${JSON.stringify({ mcpServers: { [options.name]: entry } }, null, 2)}\n`,
    );
    return 0;
  }

  let result;
  try {
    result = mergeConfig({
      name: options.name,
      entry,
      configPath: options.configPath || resolveConfigPath(),
      force: options.force,
    });
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }

  stdout.write(
    `${result.replaced ? "replaced" : "registered"} MCP server "${options.name}" in ${result.configPath}\n`,
  );
  if (result.backupPath) {
    stdout.write(`previous configuration backed up to ${result.backupPath}\n`);
  }

  // Creating the file means no existing configuration was found. That is normal
  // before Claude Desktop has ever been configured, but it is also what happens
  // when this install keeps its configuration somewhere the search does not
  // cover, so the searched locations are worth showing.
  if (result.created && !options.configPath) {
    stdout.write(
      "no existing Claude Desktop configuration was found, so this one was created.\n",
    );
    const candidates = configCandidates();
    if (candidates.length > 1) {
      stdout.write("locations searched:\n");
      for (const candidate of candidates) {
        stdout.write(`  ${candidate}\n`);
      }
      stdout.write(
        "if Claude Desktop reads a different file, re-run with --config <path>.\n",
      );
    }
  }

  stdout.write("restart Claude Desktop to load the server.\n");
  return 0;
}

/**
 * Decides what the MCP client should spawn.
 *
 * The npm spec goes through --package rather than being the command word.
 * Windows npx resolves a bare "name@version" as the command to run and fails
 * with "is not recognized as an internal or external command", so the
 * executable is named separately after --.
 */
function buildEntry(options, token, env) {
  const args = [];
  let command = options.command;

  if (!command) {
    command = "npx";
    args.push("-y", `--package=${PACKAGE_NAME}@${packageVersion(env)}`, "--", PACKAGE_NAME);
  }

  if (options.mode) {
    args.push("--mode", options.mode);
  }

  return {
    command,
    ...(args.length > 0 ? { args } : {}),
    env: { DOORAY_TOKEN: token },
  };
}

function packageVersion(env) {
  if (env.DOORAY_MCP_VERSION) {
    return env.DOORAY_MCP_VERSION;
  }
  try {
    const manifestPath = new URL("../package.json", import.meta.url);
    return JSON.parse(readFileSync(manifestPath, "utf8")).version;
  } catch {
    return "latest";
  }
}

function parseRegisterArgs(argv) {
  const options = { client: "claude-desktop", name: DEFAULT_SERVER_NAME };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    const take = (flag) => {
      if (index + 1 >= argv.length) {
        throw new Error(`${flag} requires a value`);
      }
      index += 1;
      return argv[index];
    };

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--print") {
      options.print = true;
    } else if (arg === "--client") {
      options.client = take("--client");
    } else if (arg.startsWith("--client=")) {
      options.client = arg.slice("--client=".length);
    } else if (arg === "--name") {
      options.name = take("--name");
    } else if (arg.startsWith("--name=")) {
      options.name = arg.slice("--name=".length);
    } else if (arg === "--token") {
      options.token = take("--token");
    } else if (arg.startsWith("--token=")) {
      options.token = arg.slice("--token=".length);
    } else if (arg === "--mode") {
      options.mode = take("--mode");
    } else if (arg.startsWith("--mode=")) {
      options.mode = arg.slice("--mode=".length);
    } else if (arg === "--command") {
      options.command = take("--command");
    } else if (arg.startsWith("--command=")) {
      options.command = arg.slice("--command=".length);
    } else if (arg === "--config") {
      options.configPath = take("--config");
    } else if (arg.startsWith("--config=")) {
      options.configPath = arg.slice("--config=".length);
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  if (!options.name) {
    throw new Error("--name must not be empty");
  }
  if (options.mode && options.mode !== "full" && options.mode !== "read-only") {
    throw new Error("--mode must be one of: full, read-only");
  }

  return options;
}

export function registerHelpText() {
  return `Usage: dooray-mcp-link register [--token <dooray-token>] [options]

Merges this server into the Claude Desktop configuration, keeping every other
server and setting in the file. The previous file is backed up as
${CONFIG_FILE_NAME}.bak.

Options:
  --token <token>     Dooray personal API token. Defaults to DOORAY_TOKEN.
  --name <name>       MCP server name in the config. Default: ${DEFAULT_SERVER_NAME}
  --mode read-only    Register the server with only read-only tools exposed.
  --client <client>   Target client. Only claude-desktop is supported.
  --command <path>    Executable to record. Defaults to the npx invocation.
  --config <path>     Configuration file to merge into. Defaults to the file
                      found among the platform's known locations.
  --force             Replace an existing server with the same name.
  --print             Print the JSON block instead of writing the file.
  -h, --help          Print this message.
`;
}
