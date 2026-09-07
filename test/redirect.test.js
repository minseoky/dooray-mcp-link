import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DoorayClient } from "../src/dooray.js";
import {
  assertRedirectAllowed,
  isPrivateAddress,
  MAX_DOWNLOAD_BYTES,
} from "../src/redirect.js";

test("loopback, link-local and private ranges are recognised", () => {
  const private_ = [
    "127.0.0.1",
    "localhost",
    "10.1.2.3",
    "192.168.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "169.254.169.254", // cloud metadata
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ];
  for (const host of private_) {
    assert.equal(isPrivateAddress(host), true, host);
  }

  const public_ = [
    "api.dooray.com",
    "file-api.dooray.com",
    "8.8.8.8",
    "172.32.0.1",
    "172.15.0.1",
    "192.169.0.1",
    "2001:4860:4860::8888",
  ];
  for (const host of public_) {
    assert.equal(isPrivateAddress(host), false, host);
  }
});

test("a redirect to the cloud metadata address is refused", async () => {
  await assert.rejects(
    () =>
      assertRedirectAllowed(
        new URL("https://169.254.169.254/latest/meta-data/"),
        new URL("https://api.dooray.com"),
      ),
    /private address was refused/,
  );
});

test("a redirect that leaves HTTPS is refused", async () => {
  await assert.rejects(
    () =>
      assertRedirectAllowed(
        new URL("http://file-api.dooray.com/blob"),
        new URL("https://api.dooray.com"),
      ),
    /non-HTTPS target was refused/,
  );
});

test("a public HTTPS redirect is allowed", async () => {
  await assertRedirectAllowed(
    new URL("https://file-api.dooray.com/blob"),
    new URL("https://api.dooray.com"),
  );
});

test("a name that resolves into private space is refused", async () => {
  // localhost resolves to a loopback address, so the DNS check has to catch it
  // even though the hostname itself is not a literal IP.
  await assert.rejects(
    () =>
      assertRedirectAllowed(
        new URL("https://localhost/blob"),
        new URL("https://api.dooray.com"),
      ),
    /private address/,
  );
});

test("an on-premise endpoint may redirect within private space", async () => {
  // Only the scheme is enforced when the configured endpoint is itself private,
  // because an internal deployment legitimately redirects to internal hosts.
  await assertRedirectAllowed(
    new URL("http://10.0.0.5/blob"),
    new URL("http://10.0.0.4"),
  );
});

test("a download larger than the cap is abandoned", async () => {
  const oversize = MAX_DOWNLOAD_BYTES + 1024;
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/octet-stream");
    const chunk = Buffer.alloc(1024 * 1024, 0x41);
    let written = 0;
    const push = () => {
      while (written < oversize) {
        written += chunk.length;
        if (!response.write(chunk)) {
          response.once("drain", push);
          return;
        }
      }
      response.end();
    };
    push();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const client = new DoorayClient({
    endpoint: `http://127.0.0.1:${server.address().port}`,
    token: "test-token",
    requestTimeoutMs: 30000,
    downloadDirectory: mkdtempSync(path.join(tmpdir(), "dooray-cap-")),
  });

  try {
    await assert.rejects(
      () => client.download("/files/big", "", "big"),
      new RegExp(`exceeded the ${MAX_DOWNLOAD_BYTES} byte limit`),
    );
  } finally {
    server.close();
  }
});
