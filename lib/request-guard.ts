// Origin check and fixed-window rate limiting. Pure, unit-testable.
export const MAX_PCM_BYTES = 16_000 * 2 * 60;

export function checkOrigin(origin: string | null | undefined, host: string | null | undefined): boolean {
  if (!origin) return true;
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
