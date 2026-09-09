import { describe, expect, it } from "vitest";
import { warningKey } from "./warning-key";

/**
 * Regression test for a real bug hit during Sprint 4.5 live Pluggy
 * validation: React logged "Encountered two children with the same key"
 * because `FinancialSnapshot.warnings` legitimately contained the same
 * warning text more than once (see docs/DECISIONS.md DEC-047), and the
 * dashboard used the warning text itself as the React `key`.
 */
describe("warningKey", () => {
  it("produces unique keys for repeated, semantically-equal warnings", () => {
    const warnings = [
      "Safe-to-Spend has reduced confidence because the budget for \"Beach trip: Trip budget\" is still unknown.",
      "Safe-to-Spend has reduced confidence because the budget for \"Beach trip: Trip budget\" is still unknown.",
      "Installment plan \"Existing credit card bill installment\" has an incomplete schedule.",
    ];

    const keys = warnings.map((w, index) => warningKey(w, index));

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never drops, reorders, or alters the underlying warning text", () => {
    const warnings = ["A", "A", "B", "A"];
    const keys = warnings.map((w, index) => warningKey(w, index));

    // The key still carries the original text, recoverable and in order —
    // nothing about the warning itself was changed to make the key unique.
    expect(keys.map((k) => k.slice(k.indexOf(":") + 1))).toEqual(warnings);
  });

  it("is stable for the same (text, index) pair across calls", () => {
    expect(warningKey("Some warning", 2)).toBe(warningKey("Some warning", 2));
  });

  it("distinguishes two different warnings at the same index", () => {
    expect(warningKey("Warning A", 0)).not.toBe(warningKey("Warning B", 0));
  });
});
