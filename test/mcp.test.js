import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { McpServer } from "../src/mcp.js";

/** Feeds the given text through a server and returns the parsed replies. */
async function run(input, { tools = [], handlers = new Map() } = {}) {
  const written = [];
  const server = new McpServer({
    name: "dooray",
    version: "0.1.0",
    tools,
    handlers,
    output: { write: (chunk) => written.push(chunk) },
  });

  await server.serve(Readable.from([input]));

  // Handlers resolve on the microtask queue after the stream closes.
  await new Promise((resolve) => setImmediate(resolve));

  return written
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const byId = (messages, id) => messages.find((message) => message.id === id);

test("initialize echoes the requested protocol version", async () => {
  const messages = await run(
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}\n',
  );
  const result = byId(messages, 1).result;
  assert.equal(result.protocolVersion, "2025-06-18");
  assert.equal(result.serverInfo.name, "dooray");
});

test("initialize falls back to a default protocol version", async () => {
  const messages = await run('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
  assert.equal(byId(messages, 1).result.protocolVersion, "2024-11-05");
});

test("notifications produce no output", async () => {
  const messages = await run(
    '{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","method":"ping"}\n',
  );
  assert.deepEqual(messages, []);
});

test("CRLF line endings and blank lines are tolerated", async () => {
  const messages = await run('\r\n{"jsonrpc":"2.0","id":7,"method":"ping"}\r\n\r\n');
  assert.equal(messages.length, 1);
  assert.ok(byId(messages, 7));
});

test("a parse error is reported against a null id", async () => {
  const messages = await run("not json\n");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, null);
  assert.equal(messages[0].error.code, -32700);
});

test("an unknown method returns method-not-found", async () => {
  const messages = await run('{"jsonrpc":"2.0","id":2,"method":"nope"}\n');
  assert.equal(byId(messages, 2).error.code, -32601);
  assert.match(byId(messages, 2).error.message, /method not found: nope/);
});

test("a message without jsonrpc 2.0 is ignored", async () => {
  assert.deepEqual(await run('{"id":1,"method":"ping"}\n'), []);
});

test("a tool result is wrapped as text content", async () => {
  const handlers = new Map([["echo", async (input) => input.value]]);
  const messages = await run(
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"value":"hi"}}}\n',
    { tools: [{ name: "echo" }], handlers },
  );

  assert.deepEqual(byId(messages, 3).result.content, [
    { type: "text", text: "hi" },
  ]);
});

test("a handler error becomes an RPC error", async () => {
  const handlers = new Map([
    [
      "boom",
      async () => {
        throw new Error("confirm must be true to execute this write operation");
      },
    ],
  ]);
  const messages = await run(
    '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"boom"}}\n',
    { tools: [{ name: "boom" }], handlers },
  );

  assert.equal(byId(messages, 4).error.code, -32000);
  assert.match(byId(messages, 4).error.message, /confirm must be true/);
});

test("a tool that is not registered cannot be called", async () => {
  const messages = await run(
    '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"dooray_messenger"}}\n',
  );
  assert.match(
    byId(messages, 5).error.message,
    /tool is not available: dooray_messenger/,
  );
});

test("empty resource and prompt lists are arrays", async () => {
  const messages = await run(
    '{"jsonrpc":"2.0","id":6,"method":"resources/list"}\n{"jsonrpc":"2.0","id":7,"method":"prompts/list"}\n',
  );
  assert.deepEqual(byId(messages, 6).result.resources, []);
  assert.deepEqual(byId(messages, 7).result.prompts, []);
});
