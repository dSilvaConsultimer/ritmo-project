import { afterEach, describe, expect, it } from "vitest";
import { checkRateLimit, resetRateLimits, type RateLimitPolicy } from "./rate-limit.server";

const POLICY: RateLimitPolicy = { windowMs: 1000, max: 3 };

afterEach(() => {
  resetRateLimits();
});

describe("checkRateLimit (Sprint 9 Phase 5, DEC-105)", () => {
  it("allows up to `max` calls within the window, then denies", () => {
    const key = "profile-a";
    expect(checkRateLimit(key, POLICY, 0).allowed).toBe(true);
    expect(checkRateLimit(key, POLICY, 10).allowed).toBe(true);
    expect(checkRateLimit(key, POLICY, 20).allowed).toBe(true);
    const fourth = checkRateLimit(key, POLICY, 30);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    const key = "profile-b";
    checkRateLimit(key, POLICY, 0);
    checkRateLimit(key, POLICY, 10);
    checkRateLimit(key, POLICY, 20);
    expect(checkRateLimit(key, POLICY, 30).allowed).toBe(false);

    expect(checkRateLimit(key, POLICY, 1001).allowed).toBe(true);
  });

  it("(G) different keys never share a bucket — no cross-profile interference", () => {
    const a = "profile-c";
    const b = "profile-d";
    checkRateLimit(a, POLICY, 0);
    checkRateLimit(a, POLICY, 10);
    checkRateLimit(a, POLICY, 20);
    expect(checkRateLimit(a, POLICY, 30).allowed).toBe(false);

    // A completely separate key is unaffected by A's exhausted bucket.
    expect(checkRateLimit(b, POLICY, 30).allowed).toBe(true);
  });

  it("is deterministic given an injected clock — no reliance on real wall time", () => {
    const key = "profile-e";
    const r1 = checkRateLimit(key, { windowMs: 100, max: 1 }, 500);
    const r2 = checkRateLimit(key, { windowMs: 100, max: 1 }, 550);
    const r3 = checkRateLimit(key, { windowMs: 100, max: 1 }, 601);
    expect([r1.allowed, r2.allowed, r3.allowed]).toEqual([true, false, true]);
  });
});
