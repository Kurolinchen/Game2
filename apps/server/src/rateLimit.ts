export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

interface RateLimitEntry {
  count: number;
  windowStartedAt: number;
}

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    const existing = this.entries.get(key);
    if (!existing || now - existing.windowStartedAt >= this.windowMs) {
      this.entries.set(key, { count: 1, windowStartedAt: now });
      this.prune(now);
      return { allowed: true, retryAfterMs: 0 };
    }

    existing.count += 1;
    const retryAfterMs = Math.max(
      0,
      this.windowMs - (now - existing.windowStartedAt),
    );
    return {
      allowed: existing.count <= this.limit,
      retryAfterMs: existing.count <= this.limit ? 0 : retryAfterMs,
    };
  }

  private prune(now: number): void {
    if (this.entries.size < 512) return;
    for (const [key, entry] of this.entries) {
      if (now - entry.windowStartedAt >= this.windowMs) {
        this.entries.delete(key);
      }
    }
  }
}
