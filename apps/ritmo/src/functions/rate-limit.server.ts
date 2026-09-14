import { resolveAppEnvironment, type AppEnvironment } from "@money-copilot/config";

/**
 * Server-only, centralized rate-limiting abstraction (Sprint 9 Phase 5 — see
 * docs/DECISIONS.md DEC-105). Covers AI and Open Finance action abuse; auth
 * endpoint abuse (sign-in/sign-up/password-reset) is Better Auth's OWN
 * built-in rate limiter instead (`auth.server.ts`'s `rateLimit` config) —
 * deliberately not duplicated here, per the brief's own instruction to use
 * an existing framework mechanism before building one.
 *
 * Process-local in-memory storage, on purpose — no Redis/external
 * infrastructure is provisioned this phase (brief §3/§24). **This does NOT
 * provide distributed guarantees**: if `apps/ritmo` ever runs as more than
 * one process/instance, each instance enforces its own independent counters
 * — a caller could get up to N× the configured limit by landing on N
 * different instances. This is an explicit, documented limitation, not a
 * silent one. Acceptable for a single-instance Phase 6 staging deployment;
 * revisit (shared storage — Better Auth already supports a "secondary
 * storage" backend for its own limiter, which is one option) before scaling
 * beyond one instance.
 */

export interface RateLimitPolicy {
  /** Rolling window length, in milliseconds. */
  readonly windowMs: number;
  /** Max allowed calls within the window. */
  readonly max: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  /** Only set when `allowed` is false. */
  readonly retryAfterMs?: number;
}

/**
 * Config-driven policies — the one place these numbers live, per the
 * brief's "rate limits must be policy/config driven" requirement. Deliberately
 * conservative defaults; tune based on real usage once staging exists.
 */
export const RATE_LIMIT_POLICIES = {
  /** Sustained AI usage per profile — a real cost guardrail, not a commercial quota. */
  aiCopilotSustained: { windowMs: 60 * 60 * 1000, max: 60 } satisfies RateLimitPolicy,
  /** Burst AI usage per profile — slows down a runaway client-side loop. */
  aiCopilotBurst: { windowMs: 10 * 1000, max: 3 } satisfies RateLimitPolicy,
  /**
   * Expensive, provider-calling Open Finance actions (create token, complete
   * connection, disconnect) — deliberately separate from the read/poll
   * policy below (brief §6: "Separate READ/POLL policy from EXPENSIVE
   * PROVIDER ACTION policy").
   */
  openFinanceAction: { windowMs: 60 * 1000, max: 5 } satisfies RateLimitPolicy,
  /**
   * Read-only status polling (`checkSyncProgress`/`getConnectionScreenData`)
   * — never calls Pluggy, only reads local DB state. The Phase 4 SYNCING
   * screen polls every 1.5s (~40/min); this ceiling is generous specifically
   * so that normal polling never trips it, while still bounding a runaway
   * client loop.
   */
  openFinancePoll: { windowMs: 60 * 1000, max: 120 } satisfies RateLimitPolicy,
  /** Pluggy webhook deliveries — a provider callback, not a browser client; generous, just a sanity ceiling. */
  webhook: { windowMs: 60 * 1000, max: 120 } satisfies RateLimitPolicy,
} as const;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();
let processLocalWarningLogged = false;

function warnProcessLocalOnce(environment: AppEnvironment): void {
  if (processLocalWarningLogged) return;
  if (environment !== "production" && environment !== "staging") return;
  processLocalWarningLogged = true;
  // Deliberate one-time operational notice, not a secret.
  console.warn(
    "[rate-limit] Using process-local, in-memory rate limiting. If this app ever runs as " +
      "more than one instance, limits are enforced per-instance, not globally — see " +
      "docs/DECISIONS.md DEC-105.",
  );
}

/** Test-only: clears all buckets and the one-time warning latch between test runs. */
export function resetRateLimits(): void {
  buckets.clear();
  processLocalWarningLogged = false;
}

/**
 * Checks and (if allowed) consumes one unit against `key`'s bucket for
 * `policy`. `key` must be a stable, non-PII identifier — an internal
 * `financialProfileId`, never an email/IP/name. `now` is injectable for
 * deterministic tests.
 */
export function checkRateLimit(
  key: string,
  policy: RateLimitPolicy,
  now: number = Date.now(),
): RateLimitResult {
  warnProcessLocalOnce(resolveAppEnvironment());

  const existing = buckets.get(key);
  if (!existing || now - existing.windowStart >= policy.windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }
  if (existing.count < policy.max) {
    existing.count += 1;
    return { allowed: true };
  }
  return { allowed: false, retryAfterMs: policy.windowMs - (now - existing.windowStart) };
}
