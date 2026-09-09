import { describe, expect, it, vi } from "vitest";

/**
 * Regression test for a real Sprint 4.5 bug (DEC-047): every fixture id
 * used to be generated via `createId()`, which embeds `Date.now()` and a
 * per-module counter. That's stable within a single already-running
 * process, but a FRESH evaluation of the fixtures module — a dev-server
 * restart, or Next.js Turbopack instantiating a separate module registry
 * per RSC-vs-Route-Handler "layer" (both observed live) — produces a
 * DIFFERENT id for "the same" fixture entity every time. Since `seed()`'s
 * idempotency is an upsert keyed by id, that silently defeats it: every
 * fresh re-evaluation piles up ANOTHER copy of the beach trip, the rodeo
 * event, the old-debt installment plan, etc., rather than updating the
 * one row that already exists — which is exactly what produced the
 * duplicate "Beach trip budget is still unknown" warnings a live user hit.
 *
 * `vi.resetModules()` + a fresh dynamic `import()` is the faithful way to
 * reproduce "a separate module registry" within a single test file — it
 * forces the module's top-level code (including any id generation) to
 * run again from scratch, the same as a real process restart would.
 */
describe("fixture ids are stable string literals, not createId()-generated", () => {
  it("produces byte-identical ids across two independent evaluations of the fixtures module", async () => {
    vi.resetModules();
    const first = await import("./initial-user");
    vi.resetModules();
    const second = await import("./initial-user");

    expect(second.pjRevenue.id).toBe(first.pjRevenue.id);
    expect(second.fixedExpenses.map((e) => e.id)).toEqual(first.fixedExpenses.map((e) => e.id));
    expect(second.variableBudgets.map((b) => b.id)).toEqual(first.variableBudgets.map((b) => b.id));
    expect(second.events.map((e) => e.id)).toEqual(first.events.map((e) => e.id));
    expect(second.events.flatMap((e) => e.lineItems.map((li) => li.id))).toEqual(
      first.events.flatMap((e) => e.lineItems.map((li) => li.id)),
    );
    expect(second.installmentPlans.map((p) => p.id)).toEqual(first.installmentPlans.map((p) => p.id));
    expect(second.independentLivingGoal.id).toBe(first.independentLivingGoal.id);
    expect(second.protectedPreferences.map((p) => p.id)).toEqual(
      first.protectedPreferences.map((p) => p.id),
    );
    expect(second.currentLifestyleScenario.id).toBe(first.currentLifestyleScenario.id);
    expect(second.independentLivingScenario.id).toBe(first.independentLivingScenario.id);
    expect(second.independentLivingScenario.additionalMonthlyExpenses.map((d) => d.id)).toEqual(
      first.independentLivingScenario.additionalMonthlyExpenses.map((d) => d.id),
    );
    expect(second.transactions.map((t) => t.id)).toEqual(first.transactions.map((t) => t.id));
  });

  it("produces byte-identical ids for the transaction/rule fixtures across two independent evaluations", async () => {
    vi.resetModules();
    const firstTx = await import("./transactions");
    const firstRules = await import("./rules");
    vi.resetModules();
    const secondTx = await import("./transactions");
    const secondRules = await import("./rules");

    expect(secondTx.nubankCreditCard.id).toBe(firstTx.nubankCreditCard.id);
    expect(secondTx.septemberTransactions.map((t) => t.id)).toEqual(
      firstTx.septemberTransactions.map((t) => t.id),
    );
    expect(secondRules.merchantNormalizationRules.map((r) => r.id)).toEqual(
      firstRules.merchantNormalizationRules.map((r) => r.id),
    );
    expect(secondRules.categoryRules.map((r) => r.id)).toEqual(firstRules.categoryRules.map((r) => r.id));
  });
});
