// JSON-RPC 2.0 over stdio, and the small set of Model Context Protocol methods
// this server answers.

import readline from "node:readline";

const DEFAULT_PROTOCOL_VERSION = "2024-11-05";

export class McpServer {
  constructor({ name, version, tools, handlers, output }) {
    this.name = name;
    this.version = version;
    this.tools = tools;
    this.handlers = handlers;
    this.output = output;
  }

  /** Reads newline-delimited JSON-RPC messages until the input closes. */
  serve(input) {
    // crlfDelay makes a Windows client writing CRLF parse the same as LF.
    const lines = readline.createInterface({ input, crlfDelay: Infinity });

    lines.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      let message;
      try {
        message = JSON.parse(trimmed);
      } catch (error) {
        this.#failure(null, -32700, `parse error: ${describe(error)}`);
        return;
      }

      void this.#handle(message);
    });

    return new Promise((resolve) => lines.on("close", resolve));
  }

  async #handle(message) {
    if (!message || message.jsonrpc !== "2.0") {
      return;
    }

    const { id, method, params } = message;
    const isNotification = id === undefined || id === null;

    try {
      const result = await this.#dispatch(method, params);
      if (result !== undefined && !isNotification) {
        this.#success(id, result);
      }
    } catch (error) {
      if (!isNotification) {
        this.#failure(id, error.rpcCode ?? -32000, describe(error));
      }
    }
  }

  async #dispatch(method, params) {
    switch (method) {
      case "initialize":
        return {
          protocolVersion: params?.protocolVersion || DEFAULT_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: this.name, version: this.version },
        };

      case "notifications/initialized":
        return undefined;

      case "ping":
        return {};

      case "tools/list":
        return { tools: this.tools };

      case "resources/list":
        return { resources: [] };

      case "prompts/list":
        return { prompts: [] };

      case "tools/call":
        return await this.#callTool(params);

      default: {
        const error = new Error(`method not found: ${method}`);
        error.rpcCode = -32601;
        throw error;
      }
    }
  }

  async #callTool(params) {
    const name = params?.name;
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new Error(`tool is not available: ${name}`);
    }

    const text = await handler(params?.arguments || {});
    return { content: [{ type: "text", text }] };
  }

  #success(id, result) {
    this.#send({ jsonrpc: "2.0", id, result });
  }

  #failure(id, code, message) {
    this.#send({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  }

  #send(message) {
    this.output.write(`${JSON.stringify(message)}\n`);
  }
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}
