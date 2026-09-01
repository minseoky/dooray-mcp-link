import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  DoorayClient,
  contentDispositionFileName,
  sanitizeFileName,
  shouldSendDownloadAuthorization,
} from "../src/dooray.js";

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => server.close(),
  };
}

function clientFor(origin, requestTimeoutMs = 5000) {
  return new DoorayClient({
    endpoint: origin,
    token: "test-token",
    requestTimeoutMs,
    downloadDirectory: mkdtempSync(path.join(tmpdir(), "dooray-dl-")),
  });
}

test("request sends the token, query, and JSON body", async () => {
  let seen = {};
  const server = await listen((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      seen = {
        auth: request.headers.authorization,
        contentType: request.headers["content-type"],
        url: request.url,
        body,
      };
      response.end('{"header":{"isSuccessful":true}}');
    });
  });

  try {
    const body = await clientFor(server.origin).request("POST", "/x", {
      query: { page: 0, empty: "", missing: null },
      body: { a: 1 },
    });

    assert.equal(body, '{"header":{"isSuccessful":true}}');
    assert.equal(seen.auth, "dooray-api test-token");
    assert.equal(seen.contentType, "application/json;charset=utf-8");
    assert.equal(seen.url, "/x?page=0");
    assert.equal(seen.body, '{"a":1}');
  } finally {
    server.close();
  }
});

test("a non-2xx response becomes an error carrying the body", async () => {
  const server = await listen((request, response) => {
    response.statusCode = 403;
    response.end('{"header":{"resultCode":403}}');
  });

  try {
    await assert.rejects(
      () => clientFor(server.origin).request("GET", "/x"),
      /Dooray API 403 Forbidden.*resultCode/s,
    );
  } finally {
    server.close();
  }
});

test("an empty body becomes an empty object", async () => {
  const server = await listen((request, response) => response.end());
  try {
    assert.equal(await clientFor(server.origin).request("GET", "/x"), "{}");
  } finally {
    server.close();
  }
});

test("a timeout is reported as a timeout, not a permission error", async () => {
  const server = await listen(() => {});
  try {
    await assert.rejects(
      () => clientFor(server.origin, 40).request("GET", "/x"),
      /Dooray request timed out after 40ms/,
    );
  } finally {
    server.close();
  }
});

test("download follows a redirect without leaking the token", async () => {
  let storageAuth = "absent";
  const storage = await listen((request, response) => {
    storageAuth = request.headers.authorization ?? "absent";
    response.setHeader("content-type", "image/png");
    response.setHeader(
      "content-disposition",
      "attachment; filename*=UTF-8''%ED%95%9C%EA%B8%80.png",
    );
    response.end("png-bytes");
  });

  const api = await listen((request, response) => {
    assert.equal(request.headers.authorization, "dooray-api test-token");
    response.statusCode = 302;
    response.setHeader("location", `${storage.origin}/blob`);
    response.end();
  });

  try {
    const result = await clientFor(api.origin).download("/files/3", "", "3");

    // The redirect target is neither the API origin nor file-api.dooray.com,
    // so the Dooray token must not be replayed to it.
    assert.equal(storageAuth, "absent");
    assert.equal(result.fileName, "한글.png");
    assert.equal(result.mimeType, "image/png");
    assert.equal(result.size, "png-bytes".length);
    assert.equal(result.temporary, true);
    assert.equal(readFileSync(result.filePath, "utf8"), "png-bytes");
  } finally {
    api.close();
    storage.close();
  }
});

test("download falls back to the file id for a name", async () => {
  const server = await listen((request, response) => response.end("data"));
  try {
    const result = await clientFor(server.origin).download("/files/9", "", "9");
    assert.equal(result.fileName, "9");
    assert.equal(result.mimeType, "application/octet-stream");
  } finally {
    server.close();
  }
});

test("a failed download names the origin that refused", async () => {
  const server = await listen((request, response) => {
    response.statusCode = 404;
    response.end("missing");
  });

  try {
    await assert.rejects(
      () => clientFor(server.origin).download("/files/9", "", "9"),
      new RegExp(`Dooray API 404 Not Found from ${server.origin}`),
    );
  } finally {
    server.close();
  }
});

test("content-disposition parsing prefers the encoded form", () => {
  const cases = [
    ["attachment; filename*=UTF-8''%ED%95%9C%EA%B8%80.png", "한글.png"],
    ['attachment; filename="report v2.pdf"', "report v2.pdf"],
    ["attachment; filename=plain.txt", "plain.txt"],
    ["attachment; filename=plain.txt; filename*=UTF-8''encoded.txt", "encoded.txt"],
    ["", ""],
    ["inline", ""],
  ];
  for (const [header, want] of cases) {
    assert.equal(contentDispositionFileName(header), want, header);
  }
});

test("file names are stripped of paths and characters Windows rejects", () => {
  const cases = [
    ["report.pdf", "report.pdf"],
    ["report v2.pdf", "report v2.pdf"],
    ["../../etc/passwd", "passwd"],
    ["C:\\Users\\me\\secret.txt", "secret.txt"],
    ['a:b*c?d"e<f>g|h.png', "a_b_c_d_e_f_g_h.png"],
    ["", "dooray-attachment"],
    ["...", "dooray-attachment"],
    ["/", "dooray-attachment"],
  ];
  for (const [input, want] of cases) {
    assert.equal(sanitizeFileName(input), want, input);
  }
});

test("only the API origin and file-api over HTTPS receive the token", () => {
  const cases = [
    ["https://api.dooray.com/x", true],
    ["https://file-api.dooray.com/download/abc", true],
    ["http://file-api.dooray.com/download/abc", false],
    ["https://evil.example.com/download/abc", false],
  ];
  for (const [target, want] of cases) {
    assert.equal(
      shouldSendDownloadAuthorization(new URL(target), "https://api.dooray.com"),
      want,
      target,
    );
  }
});
