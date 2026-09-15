import { describe, expect, it } from "vitest";
import { events as fixtureEvents, fixtureProfile, fromCents } from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import { freshSeededDb } from "./test-helpers";
import { getFinancialSnapshot, getSafeToSpend, getUpcomingFinancialEventsForProfile } from "./queries";
import {
  createFixedExpense,
  createIncome,
  createPlannedFinancialEvent,
  recordManualTransaction,
  updateIncome,
  updatePlannedFinancialEvent,
} from "./mutations";
import { getFixedExpensesForProfile, getRealizedIncomeForProfile } from "./queries";

const ASOF = "2026-09-05";

describe("recordManualTransaction", () => {
  it("immediately affects the FinancialSnapshot and Safe-to-Spend on the next read", async () => {
    const db = await freshSeededDb();
    const before = await getSafeToSpend(db, fixtureProfile.id, ASOF);

    await recordManualTransaction(db, fixtureProfile.id, {
      amount: fromCents(25_000),
      merchantOrDescription: "Restaurant X",
      date: ASOF,
    });

    const after = await getSafeToSpend(db, fixtureProfile.id, ASOF);
    expect(after.total.cents).toBe(before.total.cents - 25_000);
  });

  it("defaults to origin MANUAL, ACTUAL certainty, and CONSUMPTION effect", async () => {
    const db = await freshSeededDb();
    const transaction = await recordManualTransaction(db, fixtureProfile.id, {
      amount: fromCents(25_000),
      merchantOrDescription: "Restaurant X",
      date: ASOF,
    });

    expect(transaction.origin).toBe("MANUAL");
    expect(transaction.certainty).toBe("ACTUAL");
    expect(transaction.financialEffect).toBe("CONSUMPTION");
  });

  it("never fabricates a payment source when none is supplied", async () => {
    const db = await freshSeededDb();
    const transaction = await recordManualTransaction(db, fixtureProfile.id, {
      amount: fromCents(25_000),
      merchantOrDescription: "Restaurant X",
      date: ASOF,
    });

    expect(transaction.paymentSource.label).toBe("Manual entry");
    expect(transaction.paymentSource.provider).toBeUndefined();
  });

  it("reuses the same manual payment source across multiple manual transactions", async () => {
    const db = await freshSeededDb();
    const first = await recordManualTransaction(db, fixtureProfile.id, {
      amount: fromCents(10_000),
      merchantOrDescription: "Coffee shop",
      date: ASOF,
    });
    const second = await recordManualTransaction(db, fixtureProfile.id, {
      amount: fromCents(20_000),
      merchantOrDescription: "Bookstore",
      date: ASOF,
    });

    expect(second.paymentSource.id).toBe(first.paymentSource.id);
  });
});

describe("createPlannedFinancialEvent", () => {
  it("creates an event with an honest UNKNOWN budget when none is given — never invents a number", async () => {
    const db = await freshSeededDb();
    const event = await createPlannedFinancialEvent(db, fixtureProfile.id, {
      label: "Friend's wedding",
      startDate: "2026-10-10",
      endDate: "2026-10-10",
    });

    expect(event.lineItems).toHaveLength(1);
    expect(event.lineItems[0]?.certainty).toBe("UNKNOWN");
    expect(event.lineItems[0]?.amount).toBeNull();

    const events = await getUpcomingFinancialEventsForProfile(db, fixtureProfile.id, ASOF);
    expect(events.some((e) => e.event.id === event.id)).toBe(true);
  });

  it("reduces Safe-to-Spend confidence for the profile once an unknown-budget event exists", async () => {
    const db = await freshSeededDb();
    await createPlannedFinancialEvent(db, fixtureProfile.id, {
      label: "Friend's wedding",
      startDate: "2026-10-10",
      endDate: "2026-10-10",
    });

    const snapshot = await getFinancialSnapshot(db, fixtureProfile.id, ASOF);
    expect(snapshot.confidence).toBe("LOW");
  });

  it("accepts a known budget amount up front", async () => {
    const db = await freshSeededDb();
    const event = await createPlannedFinancialEvent(db, fixtureProfile.id, {
      label: "Concert",
      startDate: "2026-11-01",
      endDate: "2026-11-01",
      budgetAmount: fromCents(30_000),
    });

    expect(event.lineItems[0]?.amount?.cents).toBe(30_000);
    expect(event.lineItems[0]?.certainty).toBe("CONFIRMED");
  });
});

describe("updatePlannedFinancialEvent", () => {
  it("sets a previously-UNKNOWN budget deterministically ('Reserve R$1,200 for the beach')", async () => {
    const db = await freshSeededDb();
    const events = await getUpcomingFinancialEventsForProfile(db, fixtureProfile.id, ASOF);
    const beach = events.find((e) => e.event.label.includes("Beach"));
    expect(beach).toBeDefined();

    const updated = await updatePlannedFinancialEvent(db, fixtureProfile.id, ASOF, {
      eventId: beach!.event.id,
      budgetAmount: fromCents(120_000),
    });

    const budgetLineItem = updated.lineItems.find((li) => li.label === "Trip budget");
    expect(budgetLineItem?.amount?.cents).toBe(120_000);
    expect(budgetLineItem?.certainty).toBe("CONFIRMED");
  });

  it("immediately affects the snapshot once the budget is known", async () => {
    const db = await freshSeededDb();
    const before = await getFinancialSnapshot(db, fixtureProfile.id, ASOF);
    expect(before.confidence).toBe("LOW");

    const events = await getUpcomingFinancialEventsForProfile(db, fixtureProfile.id, ASOF);
    const beach = events.find((e) => e.event.label.includes("Beach"));
    await updatePlannedFinancialEvent(db, fixtureProfile.id, ASOF, {
      eventId: beach!.event.id,
      budgetAmount: fromCents(120_000),
    });

    const after = await getFinancialSnapshot(db, fixtureProfile.id, ASOF);
    expect(after.safeToSpend.total.cents).toBe(before.safeToSpend.total.cents - 120_000);
  });

  it("throws for an unknown eventId rather than silently no-op-ing", async () => {
    const db = await freshSeededDb();
    await expect(
      updatePlannedFinancialEvent(db, fixtureProfile.id, ASOF, {
        eventId: "does-not-exist",
        budgetAmount: fromCents(1_000),
      }),
    ).rejects.toThrow();
  });

  it("requires an explicit lineItemId when the event has multiple planned line items — never guesses", async () => {
    const db = await freshSeededDb();
    // Rodeo already happened (endDate < ASOF), so it's not "upcoming" —
    // fetch it straight from the fixture data to get its real line item ids.
    const rodeo = fixtureEvents.find((e) => e.label === "Rodeo");
    expect(rodeo).toBeDefined();
    expect(rodeo!.lineItems.filter((li) => li.status === "PLANNED").length).toBeGreaterThan(1);

    await expect(
      updatePlannedFinancialEvent(db, fixtureProfile.id, ASOF, {
        eventId: rodeo!.id,
        budgetAmount: fromCents(5_000),
      }),
    ).rejects.toThrow();
  });

  it("accepts an explicit lineItemId to disambiguate", async () => {
    const db = await freshSeededDb();
    const rodeo = fixtureEvents.find((e) => e.label === "Rodeo");
    const drinksLineItem = rodeo!.lineItems.find((li) => li.label === "Drinks");
    expect(drinksLineItem).toBeDefined();

    const updated = await updatePlannedFinancialEvent(db, fixtureProfile.id, ASOF, {
      eventId: rodeo!.id,
      lineItemId: drinksLineItem!.id,
      budgetAmount: fromCents(20_000),
    });

    const updatedDrinks = updated.lineItems.find((li) => li.id === drinksLineItem!.id);
    expect(updatedDrinks?.amount?.cents).toBe(20_000);
  });
});

describe("createFixedExpense", () => {
  it("persists a new recurring commitment, immediately visible via getFixedExpensesForProfile", async () => {
    const db = await freshSeededDb();
    const before = await getFixedExpensesForProfile(db, fixtureProfile.id, ASOF);

    const expense = await createFixedExpense(db, fixtureProfile.id, {
      label: "Streaming service",
      category: "Entertainment",
      amount: fromCents(3_990),
    });

    const after = await getFixedExpensesForProfile(db, fixtureProfile.id, ASOF);
    expect(after.length).toBe(before.length + 1);
    expect(after.some((e) => e.id === expense.id && e.amount.cents === 3_990)).toBe(true);
  });

  it("defaults to CONFIRMED certainty and unprotected — never a fabricated protection", async () => {
    const db = await freshSeededDb();
    const expense = await createFixedExpense(db, fixtureProfile.id, {
      label: "Gym",
      category: "Health",
      amount: fromCents(15_000),
    });

    expect(expense.certainty).toBe("CONFIRMED");
    expect(expense.protected).toBe(false);
  });

  it("immediately affects Safe-to-Spend as a new fixed commitment", async () => {
    const db = await freshSeededDb();
    const before = await getSafeToSpend(db, fixtureProfile.id, ASOF);

    await createFixedExpense(db, fixtureProfile.id, {
      label: "New subscription",
      category: "Entertainment",
      amount: fromCents(2_000),
    });

    const after = await getSafeToSpend(db, fixtureProfile.id, ASOF);
    expect(after.total.cents).toBe(before.total.cents - 2_000);
  });

  it("never invents a due day when none is given, and stores one exactly when given", async () => {
    const db = await freshSeededDb();
    const withoutDueDay = await createFixedExpense(db, fixtureProfile.id, {
      label: "Insurance",
      category: "Protection",
      amount: fromCents(8_000),
    });
    expect(withoutDueDay.dueDayOfMonth).toBeUndefined();

    const withDueDay = await createFixedExpense(db, fixtureProfile.id, {
      label: "Rent",
      category: "Housing",
      amount: fromCents(180_000),
      dueDayOfMonth: 5,
    });
    expect(withDueDay.dueDayOfMonth).toBe(5);
  });
});

describe("createIncome (Sprint 9, DEC-127)", () => {
  it("persists a new declared Income, immediately visible via the snapshot's income list", async () => {
    const db = await freshSeededDb();
    const income = await createIncome(db, fixtureProfile.id, {
      label: "Salário",
      grossAmount: fromCents(850_000),
    });

    const input = await repo.loadFinancialSnapshotInput(db, fixtureProfile.id, ASOF);
    expect(input.income.some((i) => i.id === income.id && i.grossAmount.cents === 850_000)).toBe(true);
  });

  it("defaults to CONFIRMED certainty and recurring — an explicit declaration is never treated as a one-off", async () => {
    const db = await freshSeededDb();
    const income = await createIncome(db, fixtureProfile.id, {
      label: "Salário",
      grossAmount: fromCents(850_000),
    });

    expect(income.certainty).toBe("CONFIRMED");
    expect(income.recurring).toBe(true);
  });

  it("immediately affects Safe-to-Spend's usable income on the next read", async () => {
    const db = await freshSeededDb();
    const before = await getSafeToSpend(db, fixtureProfile.id, ASOF);

    await createIncome(db, fixtureProfile.id, { label: "Extra income", grossAmount: fromCents(100_000) });

    const after = await getSafeToSpend(db, fixtureProfile.id, ASOF);
    expect(after.total.cents).toBe(before.total.cents + 100_000);
  });

  it("never affects realized income (a separate, real-transactions-only concept — DEC-127)", async () => {
    const db = await freshSeededDb();
    const before = await getRealizedIncomeForProfile(db, fixtureProfile.id, ASOF);

    await createIncome(db, fixtureProfile.id, { label: "Salário", grossAmount: fromCents(850_000) });

    const after = await getRealizedIncomeForProfile(db, fixtureProfile.id, ASOF);
    expect(after.cents).toBe(before.cents);
  });

  it("(DEC-130) defaults provenance to USER_DECLARED when the caller doesn't specify one", async () => {
    const db = await freshSeededDb();
    const income = await createIncome(db, fixtureProfile.id, { label: "Salário", grossAmount: fromCents(850_000) });
    expect(income.source).toBe("USER_DECLARED");
  });

  it("(DEC-130) persists an explicit source and expectedDayOfMonth", async () => {
    const db = await freshSeededDb();
    const income = await createIncome(db, fixtureProfile.id, {
      label: "Salário",
      grossAmount: fromCents(850_000),
      source: "USER_CONFIRMED_HISTORY",
      expectedDayOfMonth: 5,
    });
    expect(income.source).toBe("USER_CONFIRMED_HISTORY");
    expect(income.expectedDayOfMonth).toBe(5);

    const input = await repo.loadFinancialSnapshotInput(db, fixtureProfile.id, ASOF);
    const persisted = input.income.find((i) => i.id === income.id);
    expect(persisted?.source).toBe("USER_CONFIRMED_HISTORY");
    expect(persisted?.expectedDayOfMonth).toBe(5);
  });

  it("(DEC-130) supports all three provenance states — USER_DECLARED, HISTORY_INFERRED, USER_CONFIRMED_HISTORY", async () => {
    const db = await freshSeededDb();

    const declared = await createIncome(db, fixtureProfile.id, {
      label: "Salário CLT",
      grossAmount: fromCents(850_000),
      source: "USER_DECLARED",
    });
    expect(declared.source).toBe("USER_DECLARED");

    // HISTORY_INFERRED is reachable at the domain/mutation layer (e.g. a
    // future architecture that persists a low-confidence inference) even
    // though the copilot tool never produces it today — see
    // createIncomeTool, which always maps a confirmed pattern to
    // USER_CONFIRMED_HISTORY instead.
    const inferred = await createIncome(db, fixtureProfile.id, {
      label: "Possível freela recorrente",
      grossAmount: fromCents(200_000),
      source: "HISTORY_INFERRED",
    });
    expect(inferred.source).toBe("HISTORY_INFERRED");

    const confirmed = await createIncome(db, fixtureProfile.id, {
      label: "Salário confirmado via padrão",
      grossAmount: fromCents(850_000),
      source: "USER_CONFIRMED_HISTORY",
    });
    expect(confirmed.source).toBe("USER_CONFIRMED_HISTORY");

    const input = await repo.loadFinancialSnapshotInput(db, fixtureProfile.id, ASOF);
    expect(input.income.find((i) => i.id === declared.id)?.source).toBe("USER_DECLARED");
    expect(input.income.find((i) => i.id === inferred.id)?.source).toBe("HISTORY_INFERRED");
    expect(input.income.find((i) => i.id === confirmed.id)?.source).toBe("USER_CONFIRMED_HISTORY");
  });
});

describe("updateIncome (Sprint 9, DEC-127)", () => {
  it("updates only the fields supplied, leaving everything else exactly as it was", async () => {
    const db = await freshSeededDb();
    const income = await createIncome(db, fixtureProfile.id, {
      label: "Salário",
      grossAmount: fromCents(850_000),
    });

    const updated = await updateIncome(db, fixtureProfile.id, ASOF, {
      incomeId: income.id,
      grossAmount: fromCents(900_000),
    });

    expect(updated.grossAmount.cents).toBe(900_000);
    expect(updated.label).toBe("Salário");
    expect(updated.certainty).toBe("CONFIRMED");
  });

  it("throws rather than guess when the incomeId doesn't exist for this profile", async () => {
    const db = await freshSeededDb();
    await expect(
      updateIncome(db, fixtureProfile.id, ASOF, { incomeId: "income_does-not-exist", grossAmount: fromCents(1) }),
    ).rejects.toThrow();
  });

  it("(DEC-130) never changes source/amount just because a caller omits them — a conflicting learned pattern must be an explicit updateIncome call, never automatic", async () => {
    const db = await freshSeededDb();
    const income = await createIncome(db, fixtureProfile.id, {
      label: "Salário",
      grossAmount: fromCents(850_000),
      source: "USER_DECLARED",
    });

    // Simulating "history now shows a different amount" — merely detecting
    // that (getRecurringIncomeCandidates, exercised elsewhere) never calls
    // updateIncome by itself. Calling updateIncome with unrelated fields
    // must leave the declared amount/source exactly as the user stated.
    const updated = await updateIncome(db, fixtureProfile.id, ASOF, {
      incomeId: income.id,
      label: "Salário CLT",
    });

    expect(updated.grossAmount.cents).toBe(850_000);
    expect(updated.source).toBe("USER_DECLARED");
  });
});
