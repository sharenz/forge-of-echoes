import type { NextFunction, Request, RequestHandler, Response } from "express";

export interface RateLimiterOptions {
  windowMilliseconds: number;
  maximumRequests: number;
  /**
   * Reverse-proxy hops in front of this process. When the peer address is a
   * trusted private/loopback network, the client key is taken from
   * X-Forwarded-For at that depth; peers on other networks may never choose
   * their own bucket by forging the header.
   */
  trustedProxyHops?: number;
  now?: () => number;
}

interface WindowBucket {
  windowStartMilliseconds: number;
  count: number;
}

const SWEEP_THRESHOLD_KEYS = 4_096;
// Loopback plus RFC1918 ranges: reverse proxies (Caddy) live on these networks.
const TRUSTED_PEER_PATTERN = /^(127\.|::1$|::ffff:127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, WindowBucket>();
  private lastSweepMilliseconds = 0;

  constructor(private readonly options: RateLimiterOptions) {}

  attempt(key: string, nowMilliseconds: number): { allowed: boolean; retryAfterSeconds: number } {
    this.sweepExpired(nowMilliseconds);
    let bucket = this.buckets.get(key);
    if (!bucket || nowMilliseconds - bucket.windowStartMilliseconds >= this.options.windowMilliseconds) {
      bucket = { windowStartMilliseconds: nowMilliseconds, count: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    const resetInMilliseconds = bucket.windowStartMilliseconds + this.options.windowMilliseconds - nowMilliseconds;
    return {
      allowed: bucket.count <= this.options.maximumRequests,
      retryAfterSeconds: Math.max(1, Math.ceil(resetInMilliseconds / 1_000)),
    };
  }

  private sweepExpired(nowMilliseconds: number): void {
    const dueToTime = nowMilliseconds - this.lastSweepMilliseconds >= this.options.windowMilliseconds;
    if (!dueToTime && this.buckets.size < SWEEP_THRESHOLD_KEYS) return;
    this.lastSweepMilliseconds = nowMilliseconds;
    for (const [key, bucket] of this.buckets) {
      if (nowMilliseconds - bucket.windowStartMilliseconds >= this.options.windowMilliseconds) this.buckets.delete(key);
    }
  }
}

export function peerIsOnTrustedNetwork(peerAddress: string): boolean {
  return TRUSTED_PEER_PATTERN.test(peerAddress);
}

export function peerIsLoopback(peerAddress: string): boolean {
  return /^(127\.|::1$|::ffff:127\.)/.test(peerAddress);
}

export function clientKey(request: Request, trustedProxyHops: number): string {
  const peer = request.socket.remoteAddress ?? "unknown";
  // Only a peer on a trusted proxy network may influence its own key via
  // X-Forwarded-For; direct clients always key by their socket address.
  const forwarded = trustedProxyHops > 0 && peerIsOnTrustedNetwork(peer)
    ? request.headers["x-forwarded-for"]
    : undefined;
  if (typeof forwarded !== "string") return peer;
  const chain = forwarded.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (chain.length === 0) return peer;
  return chain[Math.max(0, chain.length - trustedProxyHops)];
}

export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  const limiter = new FixedWindowRateLimiter(options);
  const trustedProxyHops = options.trustedProxyHops ?? 0;
  return (request: Request, response: Response, next: NextFunction): void => {
    const result = limiter.attempt(clientKey(request, trustedProxyHops), (options.now ?? Date.now)());
    if (result.allowed) {
      next();
      return;
    }
    response.setHeader("Retry-After", String(result.retryAfterSeconds));
    response.status(429).json({ error: "rate_limited" });
  };
}
