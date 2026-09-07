// Guards for the download redirect chain.
//
// The redirect target comes from the Dooray API rather than from user input, so
// abusing it takes a compromised Dooray server or a hijacked *.dooray.com
// subdomain. Cheap checks are still worth having: a redirect to a cloud
// metadata address such as 169.254.169.254 would otherwise be followed, and the
// response written to disk with no size limit.

import { lookup } from "node:dns/promises";

/** Bytes a single attachment may occupy before the download is abandoned. */
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

/**
 * Reports whether a literal IP address is one that a public service should
 * never redirect to: loopback, link-local (including the cloud metadata
 * address), or an RFC 1918 private range.
 */
export function isPrivateAddress(host) {
  const address = host.replace(/^\[|\]$/g, "").toLowerCase();

  if (address === "localhost") {
    return true;
  }

  const ipv4 = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  if (address.includes(":")) {
    // IPv6 loopback, unspecified, unique-local (fc00::/7) and link-local
    // (fe80::/10). An IPv4-mapped address is judged on its IPv4 part.
    if (address === "::1" || address === "::") {
      return true;
    }
    const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) {
      return isPrivateAddress(mapped[1]);
    }
    return /^(f[cd]|fe[89ab])/.test(address);
  }

  return false;
}

/**
 * Rejects a redirect that leaves HTTPS or points into private address space.
 *
 * When the configured endpoint is itself private — an on-premise Dooray, or a
 * test server on loopback — redirects within private space are expected, so
 * only the scheme is enforced.
 */
export async function assertRedirectAllowed(redirectUrl, endpointUrl) {
  const endpointIsPrivate = isPrivateAddress(endpointUrl.hostname);

  if (!endpointIsPrivate && redirectUrl.protocol !== "https:") {
    throw new Error(
      `Dooray download redirect to a non-HTTPS target was refused: ${redirectUrl.origin}`,
    );
  }

  if (endpointIsPrivate) {
    return;
  }

  if (isPrivateAddress(redirectUrl.hostname)) {
    throw new Error(
      `Dooray download redirect to a private address was refused: ${redirectUrl.origin}`,
    );
  }

  // A public name can still resolve into private space, so the name is looked
  // up as well. A lookup failure is left to the request itself to report.
  let resolved;
  try {
    resolved = await lookup(redirectUrl.hostname, { all: true });
  } catch {
    return;
  }

  for (const { address } of resolved) {
    if (isPrivateAddress(address)) {
      throw new Error(
        `Dooray download redirect resolved to a private address and was refused: ${redirectUrl.origin} -> ${address}`,
      );
    }
  }
}
