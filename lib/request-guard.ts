// Origin check and fixed-window rate limiting. Pure, unit-testable.
export const MAX_PCM_BYTES = 16_000 * 2 * 60;

// Browsers always send Origin on POST and WebSocket upgrades, so those
// callers pass requireOrigin: a request without one is a script, not
// this app's page. Same-origin GETs may omit it, so GET routes allow that.
// Origin is not authentication (curl can set any header); it stops other
// sites' pages from driving the app's upstream keys.
export function checkOrigin(
  origin: string | null | undefined,
  host: string | null | undefined,
  opts: { requireOrigin?: boolean } = {},
): boolean {
  if (!origin) return !opts.requireOrigin;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export type RateLimitResult = { ok: boolean; retryAfterSec: number };

export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }) {
  const now = opts.now ?? (() => Date.now());
  const buckets = new Map<string, { count: number; windowStart: number }>();
  const check = (key: string): RateLimitResult => {
    const t = now();
    // prune expired
    for (const [k, v] of buckets) {
      if (t - v.windowStart >= opts.windowMs) buckets.delete(k);
    }
    const cur = buckets.get(key);
    if (!cur) {
      buckets.set(key, { count: 1, windowStart: t });
      return { ok: true, retryAfterSec: 0 };
    }
    if (cur.count >= opts.limit) {
      const retryAfterSec = Math.max(1, Math.ceil((cur.windowStart + opts.windowMs - t) / 1000));
      return { ok: false, retryAfterSec };
    }
    cur.count += 1;
    return { ok: true, retryAfterSec: 0 };
  };
  const limiter = Object.assign(check, { check });
  return limiter;
}

type HeaderLike = { get(name: string): string | null } | Record<string, string | string[] | undefined>;

function getHeader(req: unknown, name: string): string | null {
  const headers = (req as { headers?: unknown })?.headers as HeaderLike | undefined;
  if (!headers) return null;
  if (typeof (headers as { get?: unknown }).get === "function") {
    return (headers as { get(n: string): string | null }).get(name);
  }
  const rec = headers as Record<string, string | string[] | undefined>;
  const v = rec[name] ?? rec[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

// The unified server (server.mjs) calls this on every request before Next
// sees it. Unless the operator says a reverse proxy sets the forwarding
// headers (TRUST_PROXY=1), whatever the client sent is replaced with the
// socket's own address, so the rate-limit key below cannot be spoofed by
// sending a different X-Forwarded-For on each request.
export function normalizeForwardedHeaders(
  headers: Record<string, string | string[] | undefined>,
  remoteAddress: string | undefined,
  trustProxy: boolean,
): void {
  if (trustProxy) return;
  delete headers["x-real-ip"];
  if (remoteAddress) headers["x-forwarded-for"] = remoteAddress;
  else delete headers["x-forwarded-for"];
}

export function isTrustProxy(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.TRUST_PROXY ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

// Caps open WebSocket connections per client and in total. Each live
// stream holds an upstream speech session billed to the server's key.
export function createConnectionLimiter(opts: { perKey: number; total: number }) {
  const open = new Map<string, number>();
  let total = 0;
  return {
    acquire(key: string): boolean {
      const cur = open.get(key) ?? 0;
      if (cur >= opts.perKey || total >= opts.total) return false;
      open.set(key, cur + 1);
      total += 1;
      return true;
    },
    release(key: string): void {
      const cur = open.get(key) ?? 0;
      if (cur <= 0) return;
      if (cur === 1) open.delete(key);
      else open.set(key, cur - 1);
      total -= 1;
    },
    get total() {
      return total;
    },
  };
}

export function clientKey(req: unknown): string {
  const xff = getHeader(req, "x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = getHeader(req, "x-real-ip");
  if (real?.trim()) return real.trim();
  return "local";
}
