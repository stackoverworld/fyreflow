import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateIpv4Address(hostname: string): boolean {
  const segments = hostname.split(".");
  if (segments.length !== 4) {
    return false;
  }

  const bytes = segments.map((segment) => Number.parseInt(segment, 10));
  if (bytes.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) {
    return false;
  }

  if (bytes[0] === 10 || bytes[0] === 127 || bytes[0] === 0) {
    return true;
  }
  if (bytes[0] === 169 && bytes[1] === 254) {
    return true;
  }
  if (bytes[0] === 192 && bytes[1] === 168) {
    return true;
  }
  if (bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31) {
    return true;
  }
  return false;
}

function normalizeHostnameForNetworkChecks(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();
  const withoutBrackets =
    normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1).trim() : normalized;
  return withoutBrackets.replace(/\.+$/, "");
}

function parseIpv4Address(hostname: string): number[] | null {
  const segments = hostname.split(".");
  if (segments.length !== 4) {
    return null;
  }

  const bytes = segments.map((segment) => Number.parseInt(segment, 10));
  if (bytes.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) {
    return null;
  }

  return bytes;
}

function decodeMappedIpv4FromIpv6(hostname: string): string | null {
  const dottedMatch = hostname.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dottedMatch?.[1]) {
    const bytes = parseIpv4Address(dottedMatch[1]);
    return bytes ? bytes.join(".") : null;
  }

  const hexMatch = hostname.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hexMatch?.[1] || !hexMatch[2]) {
    return null;
  }

  const high = Number.parseInt(hexMatch[1], 16);
  const low = Number.parseInt(hexMatch[2], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) {
    return null;
  }

  const a = (high >> 8) & 0xff;
  const b = high & 0xff;
  const c = (low >> 8) & 0xff;
  const d = low & 0xff;
  return `${a}.${b}.${c}.${d}`;
}

function isPrivateIpv6Address(hostname: string): boolean {
  const normalized = normalizeHostnameForNetworkChecks(hostname).split("%")[0] ?? "";
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:")) {
    return true;
  }

  const mappedIpv4 = decodeMappedIpv4FromIpv6(normalized);
  if (mappedIpv4 && isPrivateIpv4Address(mappedIpv4)) {
    return true;
  }

  return normalized.startsWith("fc") || normalized.startsWith("fd");
}

function buildLabel(label: string): string {
  return label.trim().length > 0 ? label.trim() : "URL";
}

export function assertPublicHttpUrl(rawUrl: string, label = "URL"): URL {
  const safeLabel = buildLabel(label);
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${safeLabel} must be a valid URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${safeLabel} must use http or https.`);
  }

  const host = normalizeHostnameForNetworkChecks(parsed.hostname);
  if (host.length === 0) {
    throw new Error(`${safeLabel} must include a hostname.`);
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error(`${safeLabel} cannot target localhost.`);
  }
  if (host.endsWith(".local") || host.endsWith(".localdomain") || host.endsWith(".internal")) {
    throw new Error(`${safeLabel} cannot target a private network hostname.`);
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4 && isPrivateIpv4Address(host)) {
    throw new Error(`${safeLabel} cannot target a private IPv4 address.`);
  }
  if (ipVersion === 6 && isPrivateIpv6Address(host)) {
    throw new Error(`${safeLabel} cannot target a private IPv6 address.`);
  }

  return parsed;
}

export async function assertResolvedPublicAddress(rawUrl: string, label = "URL"): Promise<URL> {
  const parsed = assertPublicHttpUrl(rawUrl, label);
  const hostname = normalizeHostnameForNetworkChecks(parsed.hostname);

  if (isIP(hostname) !== 0) {
    return parsed;
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`${buildLabel(label)} hostname could not be resolved.`);
  }

  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw new Error(`${buildLabel(label)} hostname could not be resolved.`);
  }

  for (const address of resolved) {
    if (address.family === 4 && isPrivateIpv4Address(address.address)) {
      throw new Error(`${buildLabel(label)} cannot resolve to a private IPv4 address.`);
    }
    if (address.family === 6 && isPrivateIpv6Address(address.address)) {
      throw new Error(`${buildLabel(label)} cannot resolve to a private IPv6 address.`);
    }
  }

  return parsed;
}
