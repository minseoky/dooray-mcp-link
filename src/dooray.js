// Authenticated Dooray API client, including the redirect-aware attachment
// download.

import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform, Readable } from "node:stream";
import path from "node:path";

import {
  assertRedirectAllowed,
  MAX_DOWNLOAD_BYTES,
} from "./redirect.js";

// These hosts receive the Dooray token on an HTTPS redirect even though they
// are not the configured API origin. Every other origin gets no credentials.
const TRUSTED_DOWNLOAD_AUTH_HOSTS = new Set(["file-api.dooray.com"]);
const MAX_DOWNLOAD_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);

export class DoorayClient {
  constructor({ endpoint, token, requestTimeoutMs, downloadDirectory }) {
    this.endpoint = endpoint;
    this.token = token;
    this.requestTimeoutMs = requestTimeoutMs;
    this.downloadDirectory = downloadDirectory;
  }

  /** Performs a JSON API call and returns the raw response body. */
  async request(method, requestPath, { query = {}, body } = {}) {
    const url = new URL(this.endpoint + requestPath);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await this.#fetch(url, {
      method,
      headers: {
        Authorization: `dooray-api ${this.token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json;charset=utf-8" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Dooray API ${response.status} ${response.statusText}: ${text}`,
      );
    }
    return text || "{}";
  }

  /** Streams an attachment into the download directory. */
  async download(requestPath, requestedFileName, fallbackFileName) {
    const headers = {
      Authorization: `dooray-api ${this.token}`,
      Accept: "application/octet-stream",
    };
    const endpointOrigin = new URL(this.endpoint).origin;

    let response = await this.#fetch(this.endpoint + requestPath, {
      headers,
      redirect: "manual",
    });

    for (
      let redirectCount = 0;
      redirectCount < MAX_DOWNLOAD_REDIRECTS &&
      REDIRECT_STATUSES.has(response.status);
      redirectCount += 1
    ) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(
          "Dooray download redirect did not provide a Location header.",
        );
      }

      const redirectUrl = new URL(location, response.url);
      await assertRedirectAllowed(redirectUrl, new URL(this.endpoint));

      response = await this.#fetch(redirectUrl, {
        headers: shouldSendDownloadAuthorization(redirectUrl, endpointOrigin)
          ? headers
          : { Accept: "application/octet-stream" },
        redirect: "manual",
      });
    }

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(
        `Dooray API ${response.status} ${response.statusText} from ${new URL(response.url).origin}: ${responseText}`,
      );
    }

    await mkdir(this.downloadDirectory, { recursive: true });

    const fileName = sanitizeFileName(
      contentDispositionFileName(response.headers.get("content-disposition")) ||
        requestedFileName ||
        fallbackFileName,
    );
    const filePath = path.join(this.downloadDirectory, fileName);

    let size = 0;
    const counter = new Transform({
      transform(chunk, encoding, callback) {
        size += chunk.length;
        if (size > MAX_DOWNLOAD_BYTES) {
          callback(
            new Error(
              `Dooray download exceeded the ${MAX_DOWNLOAD_BYTES} byte limit`,
            ),
          );
          return;
        }
        callback(null, chunk);
      },
    });

    try {
      if (!response.body) {
        throw new Error("Dooray download response did not contain a body.");
      }
      await pipeline(
        Readable.fromWeb(response.body),
        counter,
        createWriteStream(filePath),
      );
    } catch (error) {
      await unlink(filePath).catch(() => {});
      throw error;
    }

    return {
      filePath,
      fileName,
      mimeType:
        response.headers.get("content-type") || "application/octet-stream",
      size,
      temporary: true,
    };
  }

  async #fetch(url, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(
          `Dooray request timed out after ${this.requestTimeoutMs}ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function shouldSendDownloadAuthorization(url, endpointOrigin) {
  return (
    url.origin === endpointOrigin ||
    (url.protocol === "https:" && TRUSTED_DOWNLOAD_AUTH_HOSTS.has(url.hostname))
  );
}

export function contentDispositionFileName(contentDisposition) {
  if (!contentDisposition) {
    return "";
  }

  const encodedMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }

  const plainMatch = contentDisposition.match(
    /filename=(?:"([^"]+)"|([^;\s]+))/i,
  );
  return plainMatch ? plainMatch[1] || plainMatch[2] : "";
}

/**
 * Strips directory components and the characters Windows rejects, so a name
 * chosen by the server cannot escape the download directory.
 *
 * This is deliberately pure string handling rather than path.basename, whose
 * result depends on the platform: on Windows that reads a leading "a:" as a
 * drive letter and drops it, silently losing the first characters of a name
 * that merely contains a colon.
 */
export function sanitizeFileName(fileName) {
  const raw = String(fileName ?? "");
  const lastSeparator = Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("\\"));

  let baseName = raw.slice(lastSeparator + 1);
  baseName = baseName.replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_");
  baseName = baseName.replace(/^[\s.]+|[\s.]+$/g, "");

  return /[^_]/.test(baseName) ? baseName : "dooray-attachment";
}
