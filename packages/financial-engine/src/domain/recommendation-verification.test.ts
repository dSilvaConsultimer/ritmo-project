import { describe, expect, it } from "vitest";
import * as M from "../money/index";
import { assessVerification, type AssessVerificationInput } from "./recommendation-verification";
import { DEFAULT_RECOMMENDATION_POLICY } from "./recommendation-policy";

const EFFECTIVE_DATE = "2026-09-01";
const AFTER_GRACE_PERIOD = "2026-10-20"; // 49 days later, > default 45-day grace period
const BEFORE_GRACE_PERIOD = "2026-09-10"; // 9 days later

function baseInput(overrides: Partial<AssessVerificationInput> = {}): AssessVerificationInput {
  return {
    type: "CANCEL_RECURRING_COST",
    previousObservedAmount: M.fromReais(39.9),
    effectiveDate: EFFECTIVE_DATE,
    matchingTransactionAmountsAfterEffectiveDate: [],
    asOfDate: AFTER_GRACE_PERIOD,
    lastSuccessfulSyncAt: AFTER_GRACE_PERIOD,
    ...overrides,
  };
}

describe("assessVerification", () => {
  it("(L) accepted cancellation + sufficient future evidence with no recurring charge -> CONFIRMED_SUCCESS", () => {
    expect(assessVerification(baseInput())).toBe("CONFIRMED_SUCCESS");
  });

  it("(M) accepted cancellation + recurring charge continues -> CONFIRMED_FAILURE", () => {
    const input = baseInput({ matchingTransactionAmountsAfterEffectiveDate: [M.fromReais(39.9)] });
    expect(assessVerification(input)).toBe("CONFIRMED_FAILURE");
  });

  it("remains NOT_DUE before the grace period elapses, regardless of evidence", () => {
    const input = baseInput({ asOfDate: BEFORE_GRACE_PERIOD, lastSuccessfulSyncAt: BEFORE_GRACE_PERIOD });
    expect(assessVerification(input)).toBe("NOT_DUE");
  });

  it("(N) insufficient transaction coverage (stale sync) -> INCONCLUSIVE, never falsely VERIFIED", () => {
    const staleSync = "2026-09-15"; // long before asOfDate — sync staleness exceeds policy
    const input = baseInput({ lastSuccessfulSyncAt: staleSync });
    expect(assessVerification(input)).toBe("INCONCLUSIVE");
  });

  it("a manual-only recommendation (no connection) is never blocked by sync staleness", () => {
    const input = baseInput({ lastSuccessfulSyncAt: null });
    expect(assessVerification(input)).toBe("CONFIRMED_SUCCESS");
  });

  it("REDUCE: an observed amount within tolerance of the user target -> CONFIRMED_SUCCESS", () => {
    const input = baseInput({
      type: "REDUCE_RECURRING_COST",
      userTargetAmount: M.fromReais(30),
      previousObservedAmount: M.fromReais(59.9),
      matchingTransactionAmountsAfterEffectiveDate: [M.fromReais(30.5)],
    });
    expect(assessVerification(input)).toBe("CONFIRMED_SUCCESS");
  });

  it("REDUCE: the old high amount continuing -> CONFIRMED_FAILURE", () => {
    const input = baseInput({
      type: "REDUCE_RECURRING_COST",
      userTargetAmount: M.fromReais(30),
      previousObservedAmount: M.fromReais(59.9),
      matchingTransactionAmountsAfterEffectiveDate: [M.fromReais(59.9)],
    });
    expect(assessVerification(input)).toBe("CONFIRMED_FAILURE");
  });

  it("REDUCE: no matching transaction at all -> INCONCLUSIVE (absence is not proof for a reduction)", () => {
    const input = baseInput({
      type: "REDUCE_RECURRING_COST",
      userTargetAmount: M.fromReais(30),
      previousObservedAmount: M.fromReais(59.9),
      matchingTransactionAmountsAfterEffectiveDate: [],
    });
    expect(assessVerification(input)).toBe("INCONCLUSIVE");
  });

  it("REDUCE: an amount matching neither the old nor the target price -> INCONCLUSIVE, not a guess", () => {
    const input = baseInput({
      type: "REDUCE_RECURRING_COST",
      userTargetAmount: M.fromReais(30),
      previousObservedAmount: M.fromReais(59.9),
      matchingTransactionAmountsAfterEffectiveDate: [M.fromReais(45)],
    });
    expect(assessVerification(input)).toBe("INCONCLUSIVE");
  });

  it("uses a centralized, non-hidden tolerance policy for reduction matching", () => {
    expect(DEFAULT_RECOMMENDATION_POLICY.reductionAmountToleranceRatio).toBeGreaterThan(0);
  });

  it("(DEC-061 regression) a full ISO timestamp lastSuccessfulSyncAt is not silently treated as fresh", () => {
    // A real `ProviderConnection.lastSuccessfulSyncAt` is a full timestamp
    // (e.g. "2026-09-09T18:27:26.329Z"), not a plain date — this must still
    // correctly trigger staleness, not silently no-op via an invalid
    // concatenated date string (NaN comparisons are always false).
    const input = baseInput({
      asOfDate: "2026-10-25",
      lastSuccessfulSyncAt: "2026-09-09T18:27:26.329Z", // ~46 days stale — exceeds the 10-day default
    });
    expect(assessVerification(input)).toBe("INCONCLUSIVE");
  });

  it("(DEC-061) a recent full ISO timestamp lastSuccessfulSyncAt is correctly treated as fresh", () => {
    const input = baseInput({
      asOfDate: "2026-10-25",
      lastSuccessfulSyncAt: "2026-10-20T12:00:00.000Z", // 5 days stale — within the 10-day default
    });
    expect(assessVerification(input)).toBe("CONFIRMED_SUCCESS");
  });
});
