import { describe, expect, it } from "vitest";
import { events as fixtureEvents, fixtureProfile, fromCents } from "@money-copilot/financial-engine";
import { freshSeededDb } from "./test-helpers";
import { getFinancialSnapshot, getSafeToSpend, getUpcomingFinancialEventsForProfile } from "./queries";
import {
  createPlannedFinancialEvent,
  recordManualTransaction,
  updatePlannedFinancialEvent,
} from "./mutations";

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
