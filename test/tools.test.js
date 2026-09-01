import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DoorayClient } from "../src/dooray.js";
import { buildRegistry, toolDefinitions, WRITE_TOOL_NAMES } from "../src/tools.js";

/** Starts a server that records the last request and answers with a stub. */
async function withRegistry(readOnly, run) {
  const recorded = {};
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const url = new URL(request.url, "http://127.0.0.1");
      recorded.method = request.method;
      recorded.path = url.pathname;
      recorded.query = url.search.replace(/^\?/, "");
      recorded.body = body;
      response.setHeader("content-type", "application/json");
      response.end('{"header":{"isSuccessful":true}}');
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const client = new DoorayClient({
    endpoint: `http://127.0.0.1:${port}`,
    token: "test-token",
    requestTimeoutMs: 5000,
    downloadDirectory: mkdtempSync(path.join(tmpdir(), "dooray-test-")),
  });

  try {
    await run(buildRegistry(client, readOnly), recorded);
  } finally {
    server.close();
  }
}

const WRITE_CALLS = {
  dooray_messenger: { operation: "send", to: "12345", message: "hi" },
  dooray_calendar_post_event: {
    operation: "create_event",
    subject: "s",
    content: "c",
    startedAt: "2025-04-11T09:00:00+09:00",
    endedAt: "2025-04-11T09:15:00+09:00",
  },
  dooray_post_log_create: {
    operation: "create_log",
    projectId: "1",
    postId: "2",
    body: { mimeType: "text/x-markdown", content: "hello" },
  },
  dooray_post_log_update: {
    operation: "update_log",
    projectId: "1",
    postId: "2",
    logId: "3",
    body: { mimeType: "text/x-markdown", content: "edited" },
  },
};

test("every write tool refuses a call without confirm=true", async () => {
  for (const [name, base] of Object.entries(WRITE_CALLS)) {
    for (const confirm of [undefined, false, "true", 1]) {
      await withRegistry(false, async ({ handlers }, recorded) => {
        const args = { ...base };
        if (confirm !== undefined) {
          args.confirm = confirm;
        }

        await assert.rejects(
          () => handlers.get(name)(args),
          /confirm must be true/,
          `${name} with confirm=${JSON.stringify(confirm)}`,
        );
        assert.equal(
          recorded.method,
          undefined,
          `${name} reached Dooray with confirm=${JSON.stringify(confirm)}`,
        );
      });
    }
  }
});

test("write tools run with confirm=true and do not forward the flag", async () => {
  for (const [name, base] of Object.entries(WRITE_CALLS)) {
    await withRegistry(false, async ({ handlers }, recorded) => {
      await handlers.get(name)({ ...base, confirm: true });
      assert.ok(recorded.method, `${name} did not reach Dooray`);
      assert.ok(!recorded.body.includes("confirm"), `${name} forwarded confirm`);
    });
  }
});

test("write tool schemas require confirm and read tools do not", () => {
  for (const tool of toolDefinitions()) {
    const required = tool.inputSchema.required;
    if (WRITE_TOOL_NAMES.has(tool.name)) {
      assert.ok(required.includes("confirm"), `${tool.name} must require confirm`);
      assert.ok(
        Object.hasOwn(tool.inputSchema.properties, "confirm"),
        `${tool.name} must declare confirm`,
      );
    } else {
      assert.ok(
        !required.includes("confirm"),
        `${tool.name} must not require confirm`,
      );
    }
  }
});

test("read-only mode hides every write tool", async () => {
  await withRegistry(true, async ({ tools, handlers }) => {
    for (const name of WRITE_TOOL_NAMES) {
      assert.ok(!handlers.has(name), `${name} must be hidden`);
      assert.ok(!tools.some((tool) => tool.name === name));
    }
    for (const name of ["dooray_posts", "dooray_post_file_download", "os"]) {
      assert.ok(handlers.has(name), `${name} must stay visible`);
    }
    assert.equal(tools.length, handlers.size);
  });
});

test("dooray_messenger is treated as a write tool", () => {
  assert.ok(WRITE_TOOL_NAMES.has("dooray_messenger"));
});

test("full mode exposes every tool", async () => {
  await withRegistry(false, async ({ tools, handlers }) => {
    assert.equal(tools.length, toolDefinitions().length);
    for (const tool of toolDefinitions()) {
      assert.ok(handlers.has(tool.name), `${tool.name} has no handler`);
    }
  });
});

test("an operation mismatch is rejected before any request", async () => {
  await withRegistry(false, async ({ handlers }, recorded) => {
    await assert.rejects(
      () => handlers.get("dooray_posts")({ operation: "wrong", projectId: "1" }),
      /operation must be find_posts/,
    );
    assert.equal(recorded.method, undefined);
  });
});

test("dooray_posts drops empty optional filters", async () => {
  await withRegistry(false, async ({ handlers }, recorded) => {
    await handlers.get("dooray_posts")({
      operation: "find_posts",
      projectId: "3157232",
      page: 0,
      size: 100,
      subjects: "",
      order: "-postUpdatedAt",
      tagIds: null,
    });

    assert.equal(recorded.path, "/project/v1/projects/3157232/posts");
    const query = new URLSearchParams(recorded.query);
    assert.equal(query.get("page"), "0");
    assert.equal(query.get("size"), "100");
    assert.equal(query.get("order"), "-postUpdatedAt");
    assert.ok(!query.has("subjects"));
    assert.ok(!query.has("tagIds"));
  });
});

test("dooray_project applies the page and size defaults", async () => {
  await withRegistry(false, async ({ handlers }, recorded) => {
    await handlers.get("dooray_project")({
      operation: "find_projects",
      type: "private",
      scope: "private",
      state: "active",
    });

    const query = new URLSearchParams(recorded.query);
    assert.equal(query.get("member"), "me");
    assert.equal(query.get("page"), "0");
    assert.equal(query.get("size"), "100");
  });
});

test("dooray_post_log_create wraps the body and uses POST", async () => {
  await withRegistry(false, async ({ handlers }, recorded) => {
    await handlers.get("dooray_post_log_create")({
      ...WRITE_CALLS.dooray_post_log_create,
      confirm: true,
    });

    assert.equal(recorded.method, "POST");
    assert.equal(recorded.path, "/project/v1/projects/1/posts/2/logs");
    assert.deepEqual(JSON.parse(recorded.body), {
      body: { mimeType: "text/x-markdown", content: "hello" },
    });
  });
});

test("dooray_post_log_update uses PUT", async () => {
  await withRegistry(false, async ({ handlers }, recorded) => {
    await handlers.get("dooray_post_log_update")({
      ...WRITE_CALLS.dooray_post_log_update,
      confirm: true,
    });

    assert.equal(recorded.method, "PUT");
    assert.equal(recorded.path, "/project/v1/projects/1/posts/2/logs/3");
  });
});

test("a missing comment body is rejected", async () => {
  await withRegistry(false, async ({ handlers }) => {
    await assert.rejects(
      () =>
        handlers.get("dooray_post_log_create")({
          operation: "create_log",
          projectId: "1",
          postId: "2",
          confirm: true,
        }),
      /body must be an object/,
    );
  });
});

test("dooray_calendar_post_event defaults the recurrence rule", async () => {
  await withRegistry(false, async ({ handlers }, recorded) => {
    await handlers.get("dooray_calendar_post_event")({
      ...WRITE_CALLS.dooray_calendar_post_event,
      confirm: true,
      recurrenceFrequency: "weekly",
      recurrenceByday: "MO,TU",
    });

    const sent = JSON.parse(recorded.body);
    assert.equal(sent.wholeDayFlag, false);
    assert.equal(sent.recurrenceRule.interval, 1);
    assert.equal(sent.recurrenceRule.timezoneName, "Asia/Seoul");
    assert.equal(sent.recurrenceRule.byday, "MO,TU");
  });
});

test("dooray_calendar_post_event omits the recurrence rule when unset", async () => {
  await withRegistry(false, async ({ handlers }, recorded) => {
    await handlers.get("dooray_calendar_post_event")({
      ...WRITE_CALLS.dooray_calendar_post_event,
      confirm: true,
    });
    assert.ok(!recorded.body.includes("recurrenceRule"));
  });
});

test("the os tool returns a parseable local time", async () => {
  await withRegistry(false, async ({ handlers }) => {
    const { time } = JSON.parse(
      await handlers.get("os")({ operation: "get_date_time" }),
    );
    assert.match(time, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
