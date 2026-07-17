import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "./rateLimit.js";

describe("FixedWindowRateLimiter", () => {
  it("blocks requests above the configured limit", () => {
    const limiter = new FixedWindowRateLimiter(2, 1_000);

    expect(limiter.check("player", 100).allowed).toBe(true);
    expect(limiter.check("player", 200).allowed).toBe(true);
    expect(limiter.check("player", 300)).toEqual({
      allowed: false,
      retryAfterMs: 800,
    });
  });

  it("opens a fresh window after the timeout", () => {
    const limiter = new FixedWindowRateLimiter(1, 500);

    expect(limiter.check("player", 0).allowed).toBe(true);
    expect(limiter.check("player", 200).allowed).toBe(false);
    expect(limiter.check("player", 500).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000);

    expect(limiter.check("alpha", 0).allowed).toBe(true);
    expect(limiter.check("bravo", 0).allowed).toBe(true);
    expect(limiter.check("alpha", 1).allowed).toBe(false);
  });
});
