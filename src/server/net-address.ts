// Client addresses for rate limiting and logs.
//
// Behind a reverse proxy the socket peer is the proxy, and the client's address travels in
// X-Forwarded-For. Every proxy APPENDS the address it received the request from, so only the entries
// added by our own proxies can be trusted — anything further left was written by the client. With
// `trustedProxies = n` the client is the n-th entry from the right, and the header is honoured only when
// the socket peer is itself a loopback / private address (a proxy of ours, not someone on the internet).
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

/** '::ffff:10.0.0.1' → '10.0.0.1'; everything else unchanged. */
export function normalizeIp(ip: string): string {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return m ? m[1] : ip;
}

function ipv4Octets(ip: string): number[] | null {
  if (isIP(ip) !== 4) return null;
  return ip.split('.').map(Number);
}

export function isLoopback(raw: string): boolean {
  const ip = normalizeIp(raw);
  if (ip === '::1') return true;
  const o = ipv4Octets(ip);
  return o !== null && o[0] === 127;
}

/** Loopback, RFC 1918, link-local, CGNAT (100.64/10) and IPv6 unique-local / link-local addresses. */
export function isPrivateAddress(raw: string): boolean {
  const ip = normalizeIp(raw);
  if (isLoopback(ip)) return true;
  const o = ipv4Octets(ip);
  if (o) {
    return (
      o[0] === 10 ||
      (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
      (o[0] === 192 && o[1] === 168) ||
      (o[0] === 169 && o[1] === 254) ||
      (o[0] === 100 && o[1] >= 64 && o[1] <= 127)
    );
  }
  if (isIP(ip) === 6) {
    const head = ip.toLowerCase();
    return /^f[cd][0-9a-f]{2}:/.test(head) || /^fe[89ab][0-9a-f]:/.test(head);
  }
  return false;
}

/**
 * The address a request comes from. `trustedProxies` = the number of reverse proxies of ours in front of
 * the server (0 = use the socket peer).
 */
export function clientIp(req: IncomingMessage, trustedProxies: number): string {
  const peer = normalizeIp(req.socket.remoteAddress ?? 'unknown');
  if (trustedProxies <= 0 || !isPrivateAddress(peer)) return peer;
  const header = req.headers['x-forwarded-for'];
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (!raw) return peer;
  const hops = raw.split(',').map((h) => h.trim()).filter((h) => h.length > 0);
  if (hops.length === 0) return peer;
  const candidate = normalizeIp(hops[Math.max(0, hops.length - trustedProxies)]);
  return isIP(candidate) ? candidate : peer;
}
